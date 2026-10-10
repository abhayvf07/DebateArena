// Redis cache helpers
const Redis = require("ioredis");

let client = null;

const normalizeRedisUrl = () => {
  const rawRedisUrl = process.env.REDIS_URL?.trim().replace(/^['"]|['"]$/g, "") || "";

  if (!rawRedisUrl) {
    console.warn("REDIS_URL not set — caching disabled");
    return null;
  }

  const looksLikeCliCommand = /^redis-cli\b/i.test(rawRedisUrl) || /\s/.test(rawRedisUrl) && !/^rediss?:\/\//i.test(rawRedisUrl);

  if (looksLikeCliCommand) {
    console.warn("REDIS_URL is not a valid Redis connection string; caching disabled. Example: redis://localhost:6379 or rediss://user:pass@host:6379");
    return null;
  }

  try {
    const parsedUrl = new URL(rawRedisUrl);
    if (!["redis:", "rediss:"].includes(parsedUrl.protocol)) {
      throw new Error("Unsupported URL scheme");
    }
    return rawRedisUrl;
  } catch (error) {
    console.warn(`REDIS_URL is invalid: ${error.message}. Caching disabled.`);
    return null;
  }
};

const redisUrl = normalizeRedisUrl();

// Connect if REDIS_URL is set, otherwise skip caching
if (redisUrl) {
  const isTls = redisUrl.startsWith("rediss://");

  client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: 5000,
    retryStrategy(times) {
      return Math.min(times * 100, 2000);
    },
    ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
  });

  client.on("connect", () => console.log("Redis connected"));
  client.on("ready", () => console.log("Redis ready"));
  client.on("error", (err) => {
    console.warn(`Redis error: ${err.message}`);
  });
  client.on("end", () => {
    console.warn("Redis connection ended");
  });

  client.connect().catch((err) => {
    console.warn(`Redis connection failed: ${err.message}. Caching disabled.`);
    client = null;
  });
}

// Get cached data by key
const getCache = async (key) => {
  if (!client) return null;
  try {
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
};

// Save data to cache with TTL in seconds
const setCache = async (key, data, ttl) => {
  if (!client) return;
  try {
    await client.setex(key, ttl, JSON.stringify(data));
  } catch (err) {
    console.warn(`Cache write failed for key "${key}": ${err.message}`);
  }
};

// Delete a single cached key
const deleteCache = async (key) => {
  if (!client) return;
  try {
    await client.del(key);
  } catch (err) {
    console.warn(`Cache delete failed for key "${key}": ${err.message}`);
  }
};

// Delete all keys matching a wildcard pattern (e.g. "debates:*")
// Uses SCAN (not KEYS) to avoid blocking Redis, and pipelines batch deletes
async function deleteCachePattern(pattern) {
  if (!client) return;
  try {
    const stream = client.scanStream({
      match: pattern,
      count: 100,
    });

    for await (const keys of stream) {
      if (keys.length) {
        const pipeline = client.pipeline();
        keys.forEach((key) => pipeline.del(key));
        await pipeline.exec();
      }
    }
  } catch (err) {
    console.error(`Error deleting cache pattern "${pattern}": ${err.message}`);
  }
}

module.exports = { getCache, setCache, deleteCache, deleteCachePattern };