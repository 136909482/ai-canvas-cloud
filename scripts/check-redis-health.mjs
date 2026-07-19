import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  process.exit(1);
}

const client = new Redis(redisUrl, {
  connectTimeout: 1_000,
  commandTimeout: 1_000,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

try {
  await client.ping();
  await client.quit();
} catch {
  client.disconnect(false);
  process.exit(1);
}
