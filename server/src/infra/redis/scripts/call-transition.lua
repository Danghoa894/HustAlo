-- call-transition.lua — compare-and-set trạng thái cuộc gọi (DB §5.4, kiến trúc §8.1)
-- KEYS[1]=call:active:{callId} KEYS[2]=call:deadlines KEYS[3]=user:incall:{callerId} KEYS[4]=user:incall:{calleeId}
-- KEYS[5]=call:pending:{calleeId}
-- ARGV: 1 callId, 2 expectedFrom (CSV), 3 to, 4 isTerminal ('1'|'0'), 5 fieldsJson (object),
--       6 removeDeadlinesJson (array of suffix), 7 addDeadlinesJson (array of [suffix, scoreMs])
if redis.call('EXISTS', KEYS[1]) == 0 then return {-1} end
local st = redis.call('HGET', KEYS[1], 'status')
local ok = false
for s in string.gmatch(ARGV[2], '([^,]+)') do if s == st then ok = true end end
local ver = tonumber(redis.call('HGET', KEYS[1], 'version'))
if not ok then return {0, st, tostring(ver)} end

ver = ver + 1
redis.call('HSET', KEYS[1], 'status', ARGV[3], 'version', ver)
local fields = cjson.decode(ARGV[5])
for k, v in pairs(fields) do redis.call('HSET', KEYS[1], k, tostring(v)) end
for _, suffix in ipairs(cjson.decode(ARGV[6])) do redis.call('ZREM', KEYS[2], ARGV[1] .. ':' .. suffix) end
for _, pair in ipairs(cjson.decode(ARGV[7])) do redis.call('ZADD', KEYS[2], pair[2], ARGV[1] .. ':' .. pair[1]) end
if ARGV[3] ~= 'INITIATED' then redis.call('SREM', KEYS[5], ARGV[1]) end

if ARGV[4] == '1' then
  if redis.call('GET', KEYS[3]) == ARGV[1] then redis.call('DEL', KEYS[3]) end
  if redis.call('GET', KEYS[4]) == ARGV[1] then redis.call('DEL', KEYS[4]) end
  -- xóa mọi deadline còn lại của call (RING/CONNECT/RECONNECT/PEER:*)
  local all = redis.call('ZRANGE', KEYS[2], 0, -1)
  local pfx = ARGV[1] .. ':'
  for _, m in ipairs(all) do if string.sub(m, 1, #pfx) == pfx then redis.call('ZREM', KEYS[2], m) end end
  redis.call('EXPIRE', KEYS[1], 300)
end
return {1, ARGV[3], tostring(ver)}
