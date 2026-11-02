// server/src/modules/calls/calls.repository.ts — Mongo callHistory (DB §2.8, §4.6). Mọi ghi là update có điều kiện
// `status ∈ expectedFrom` (hoặc ∉ terminal) và `version < version mới`: ghi cũ đến muộn bị bỏ qua.
import { CALL_ACTIVE_STATUSES, CALL_TERMINAL_STATUSES } from '@hustalo/shared';
import type { CallEndReason, CallStatus, CallType } from '@hustalo/shared';
import { Types } from 'mongoose';
import { AppError } from '../../http/errors/app-error';
import { tupleLt } from '../../infra/db/tuple';
import { CallHistoryModel } from './callHistory.model';

export interface CallHistoryRecord {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  callType: CallType;
  callerId: Types.ObjectId;
  calleeId: Types.ObjectId;
  participantIds: Types.ObjectId[];
  callerDeviceId: string;
  callerTabId: string;
  acceptedDeviceId: string | null;
  acceptedTabId: string | null;
  status: CallStatus;
  endReason: CallEndReason | null;
  version: number;
  iceRestarts: number;
  acceptedAt: Date | null;
  connectedAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewCall {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  callType: CallType;
  callerId: Types.ObjectId;
  calleeId: Types.ObjectId;
  callerDeviceId: string;
  callerTabId: string;
  status: 'INITIATED' | 'BUSY';
  endReason?: CallEndReason;
  endedAt?: Date;
  createdAt: Date;
}

export interface CallUpdate {
  status: CallStatus;
  version: number;
  acceptedDeviceId?: string;
  acceptedTabId?: string;
  acceptedAt?: Date;
  connectedAt?: Date;
  iceRestarts?: number;
}

const TERMINAL = [...CALL_TERMINAL_STATUSES];

export const callsRepository = {
  async insert(c: NewCall): Promise<void> {
    await CallHistoryModel.create({
      ...c,
      participantIds: [c.callerId, c.calleeId],
      endReason: c.endReason ?? null,
      endedAt: c.endedAt ?? null,
    });
  },

  /** Chuyển trạng thái không terminal (§8.1: status ∉ terminal, version mới hơn). `connectedAt` chỉ set lần đầu. */
  async update(id: Types.ObjectId | string, u: CallUpdate) {
    const { connectedAt, ...rest } = u;
    const res = await CallHistoryModel.updateOne({ _id: id, status: { $nin: TERMINAL }, version: { $lt: u.version } }, [
      { $set: { ...rest, ...(connectedAt ? { connectedAt: { $ifNull: ['$connectedAt', connectedAt] } } : {}) } },
    ]);
    return { changed: res.modifiedCount === 1 };
  },

  /** iceRestarts không đổi status/version (T30). */
  setIceRestarts: async (id: string, n: number) => {
    await CallHistoryModel.updateOne({ _id: id, status: { $nin: TERMINAL } }, { $max: { iceRestarts: n } });
  },

  /** DB §4.6: kết thúc idempotent; đã terminal hoặc version cũ → trả bản hiện tại, changed=false. */
  async finalize(
    callId: Types.ObjectId | string,
    upd: { status: CallStatus; endReason: CallEndReason; endedAt: Date; version: number },
  ): Promise<{ record: CallHistoryRecord; changed: boolean }> {
    const res = await CallHistoryModel.findOneAndUpdate(
      { _id: callId, status: { $nin: TERMINAL }, version: { $lt: upd.version } },
      [
        {
          $set: {
            status: upd.status,
            endReason: upd.endReason,
            endedAt: upd.endedAt,
            version: upd.version,
            durationSec: {
              $cond: [
                { $ne: ['$connectedAt', null] },
                { $floor: { $divide: [{ $subtract: [upd.endedAt, '$connectedAt'] }, 1000] } },
                null,
              ],
            },
          },
        },
      ],
      { new: true },
    ).lean<CallHistoryRecord>();
    if (res) return { record: res, changed: true };
    const current = await CallHistoryModel.findById(callId).lean<CallHistoryRecord>();
    if (!current) throw new AppError('CALL_NOT_FOUND', 'Không tìm thấy cuộc gọi');
    return { record: current, changed: false };
  },

  findById: async (id: string): Promise<CallHistoryRecord | null> =>
    Types.ObjectId.isValid(id) ? CallHistoryModel.findById(id).lean<CallHistoryRecord>() : null,

  /** GET /calls (index participant_created). */
  async page(userId: string, cursor: { at: Date; id: Types.ObjectId } | null, limit: number) {
    const docs = await CallHistoryModel.find({
      participantIds: new Types.ObjectId(userId),
      ...(cursor ? tupleLt(cursor.at, cursor.id) : {}),
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean<CallHistoryRecord[]>();
    return docs;
  },

  /** §8.5 bước 1: record active mồ côi (index active_reconcile). */
  async findActiveBefore(updatedBefore: Date, limit: number): Promise<CallHistoryRecord[]> {
    const docs = await CallHistoryModel.find({
      status: { $in: [...CALL_ACTIVE_STATUSES] },
      updatedAt: { $lt: updatedBefore },
    })
      .limit(limit)
      .lean<CallHistoryRecord[]>();
    return docs;
  },
};

export type CallsRepository = typeof callsRepository;
