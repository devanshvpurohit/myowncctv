import { redis } from "./_redis.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  await redis.set("esp32:lastSeen", Date.now(), { ex: 30 });

  const pending = await redis.get("esp32:command");
  if (pending) {
    await redis.del("esp32:command");
    return res.status(200).json(typeof pending === "string" ? JSON.parse(pending) : pending);
  }

  return res.status(200).json({ command: "none" });
}
