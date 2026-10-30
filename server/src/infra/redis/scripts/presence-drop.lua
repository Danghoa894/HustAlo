-- presence-drop.lua — socket ngắt (DB Phụ lục A, kiến trúc §7(d))
-- KEYS[1]=presence:conns:{u} KEYS[2]=presence:offline-pending
-- ARGV: 1 connId, 2 nowMs, 3 graceMs, 4 userId
redis.call('ZREM', KEYS[1], ARGV[1])
local alive = redis.call('ZCOUNT', KEYS[1], tonumber(ARGV[2]), '+inf')
if alive == 0 then
  redis.call('ZADD', KEYS[2], tonumber(ARGV[2]) + tonumber(ARGV[3]), ARGV[4])
  return 1
end
return 0
