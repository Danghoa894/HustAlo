// server/src/infra/db/tuple.ts — điều kiện so sánh tuple (thời gian, _id) cho phân trang cursor (database_schema.md §4)
import type { Types } from 'mongoose';

export const tupleLt = (t: Date, id: Types.ObjectId, f = 'createdAt') => ({
  $or: [{ [f]: { $lt: t } }, { [f]: t, _id: { $lt: id } }],
});

export const tupleGt = (t: Date, id: Types.ObjectId, f = 'createdAt') => ({
  $or: [{ [f]: { $gt: t } }, { [f]: t, _id: { $gt: id } }],
});
