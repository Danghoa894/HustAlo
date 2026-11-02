-- call-invite.lua — kiểm tra bận/glare và tạo cuộc gọi trong một bước (DB §5.4, kiến trúc §7(e), §7(g))
-- KEYS[1]=user:incall:{caller} KEYS[2]=user:incall:{callee} KEYS[3]=call:active:{newCallId}
-- KEYS[4]=call:deadlines KEYS[5]=call:pending:{calleeId}
-- ARGV: 1 newCallId, 2 callerId, 3 calleeId, 4 conversationId, 5 callType, 6 callerDeviceId,
--       7 callerTabId, 8 nowMs, 9 ringTimeoutMs, 10 stateTtlS, 11 keyPrefix, 12 connectTimeoutMs
local now = tonumber(ARGV[8])
local TERMINAL = { ENDED = true, REJECTED = true, CANCELLED = true, MISSED = true, BUSY = true, FAILED = true }
-- Key user:incall "treo" (trỏ tới cuộc gọi đã terminal hoặc call:active không còn) không chặn cuộc gọi mới: kiểm và
-- xóa ngay trong script (atomic); danh sách "userId=callId" đã dọn trả về phần tử 5 để service log warn.
local stale = {}
local function liveOrNil(key, userId)
  local id = redis.call('GET', key)
  if not id then return nil end
  local st = redis.call('HGET', ARGV[11] .. 'call:active:' .. id, 'status')
  if not st or TERMINAL[st] then
    redis.call('DEL', key)
    table.insert(stale, userId .. '=' .. id)
    return nil
  end
  return id
end
-- Mọi kết quả cùng dạng {result, callId, version|'', callType|'', staleCsv}
local function out(result, id, v, t) return {result, id, v or '', t or '', table.concat(stale, ',')} end
local mine = liveOrNil(KEYS[1], ARGV[2])
local theirs = liveOrNil(KEYS[2], ARGV[3])

-- GLARE chỉ khi đủ 3 điều kiện: (1) ngược chiều — callerId của cuộc gọi đang có = callee hiện tại và calleeId =
-- caller hiện tại, cùng conversation; (2) cuộc gọi đó còn ở INITIATED/RINGING; (3) cuộc gọi còn sống (liveOrNil).
-- D-06 set user:incall cho cả hai bên nên ở glare cả hai key cùng trỏ một callId; phải xét glare TRƯỚC CALLER_IN_CALL.
if mine and mine == theirs then
  local otherKey = ARGV[11] .. 'call:active:' .. theirs
  local h = redis.call('HMGET', otherKey, 'status', 'callerId', 'calleeId', 'conversationId', 'version', 'callType')
  local st = h[1]
  if h[2] == ARGV[3] and h[3] == ARGV[2] and h[4] == ARGV[4] and (st == 'INITIATED' or st == 'RINGING') then
    -- GLARE: lời mời ngược chiều của chính callee → ACCEPTED, người mời thứ hai là tab đã accept
    local v = tonumber(h[5]) + 1
    redis.call('HSET', otherKey, 'status', 'ACCEPTED', 'version', v,
      'acceptedDeviceId', ARGV[6], 'acceptedTabId', ARGV[7], 'acceptedAt', now)
    redis.call('ZREM', KEYS[4], theirs .. ':RING')
    redis.call('ZADD', KEYS[4], now + tonumber(ARGV[12]), theirs .. ':CONNECT')
    redis.call('SREM', ARGV[11] .. 'call:pending:' .. ARGV[2], theirs)
    return out('GLARE', theirs, tostring(v), h[6])
  end
end
if mine then return out('CALLER_IN_CALL', mine) end -- gọi trùng cùng chiều, hoặc đang trong cuộc gọi đã trả lời
if theirs then return out('BUSY', theirs) end

redis.call('HSET', KEYS[3],
  'status', 'INITIATED', 'version', 1, 'callType', ARGV[5], 'conversationId', ARGV[4],
  'callerId', ARGV[2], 'calleeId', ARGV[3], 'callerDeviceId', ARGV[6], 'callerTabId', ARGV[7],
  'acceptedDeviceId', '', 'acceptedTabId', '', 'offerRevision', 0, 'answeredRevision', 0,
  'iceRestarts', 0, 'createdAt', now, 'acceptedAt', '', 'connectedAt', '', 'endReason', '')
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[10]))
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[10]))
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[10]))
redis.call('ZADD', KEYS[4], now + tonumber(ARGV[9]), ARGV[1] .. ':RING')
redis.call('SADD', KEYS[5], ARGV[1])
redis.call('PEXPIRE', KEYS[5], tonumber(ARGV[9]))
return out('CREATED', ARGV[1])
