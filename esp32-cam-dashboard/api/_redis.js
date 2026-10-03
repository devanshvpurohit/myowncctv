/**
 * Shared Upstash Redis client
 *
 * Reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from env.
 * These are set automatically when you add the Upstash Redis integration
 * in the Vercel dashboard: vercel.com/your-project → Storage → Add → Redis
 *
 * See: https://upstash.com/docs/redis/sdks/ts/getstarted
 */
import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
