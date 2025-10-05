const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
// Simple helpers
async function cacheGet(key) {
  const val = await redis.get(key);
  return val ? JSON.parse(val) : null;
}
async function cacheSet(key, value, ttlSeconds = 30) {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}
async function cacheDelByPrefix(prefix) {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(keys);
}
module.exports = { redis, cacheGet, cacheSet, cacheDelByPrefix };
