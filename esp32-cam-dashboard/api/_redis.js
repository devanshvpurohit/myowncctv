/**
 * Shared Upstash Redis client
 *
 * Reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from env.
 * These are set automatically when you add the Upstash Redis integration
 * in the Vercel dashboard:
 *   vercel.com → your project → Storage → Add → Upstash Redis
 *
 * If the env vars are missing, the helper below returns a mock client
 * that always resolves to null (so the API routes return graceful errors
 * instead of crashing with 500).
 *
 * See: https://upstash.com/docs/redis/sdks/ts/getstarted
 */
import { Redis } from "@upstash/redis";

function makeClient() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    // Return a no-op mock so routes fail gracefully instead of throwing
    const noop = async () => null;
    return { get: noop, set: noop, del: noop, configured: false };
  }

  return Object.assign(new Redis({ url, token }), { configured: true });
}

export const redis = makeClient();

/** Returns a 503 response if Redis is not configured */
export function requireRedis(res) {
  if (!redis.configured) {
    res.status(503).json({
      error:  "Redis not configured",
      detail: "Add Upstash Redis in your Vercel project: vercel.com → Storage → Add → Upstash Redis. The env vars UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN will be set automatically.",
    });
    return false;
  }
  return true;
}
