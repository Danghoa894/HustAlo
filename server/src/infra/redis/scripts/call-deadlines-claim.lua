-- call-deadlines-claim.lua — claim nguyên tử (DB Phụ lục A): dùng cho call:deadlines, presence:offline-pending, presence:users
-- KEYS[1]=zset ARGV[1]=nowMs ARGV[2]=limit
local items = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for _, m in ipairs(items) do redis.call('ZREM', KEYS[1], m) end
return items
