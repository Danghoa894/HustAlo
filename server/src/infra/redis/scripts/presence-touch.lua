-- presence-touch.lua — connect và heartbeat (DB Phụ lục A, kiến trúc §7(d))
-- KEYS[1]=presence:conns:{u} KEYS[2]=presence:users KEYS[3]=presence:offline-pending
-- ARGV: 1 connId, 2 nowMs, 3 leaseMs, 4 userId
local now = tonumber(ARGV[2])
local exp = now + tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local before = redis.call('ZCOUNT', KEYS[1], now, '+inf')
redis.call('ZADD', KEYS[1], exp, ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
redis.call('ZADD', KEYS[2], 'GT', exp, ARGV[4])
local pendingRemoved = redis.call('ZREM', KEYS[3], ARGV[4])
if before == 0 and pendingRemoved == 0 then return 1 end -- vừa ONLINE → phát presence:update
return 0
