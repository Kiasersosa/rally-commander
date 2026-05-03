// Daily expiry-alert cron entrypoint. Sends SMS to opted-in users for any
// item in the expired or 1-week band.

import { runDailyExpiryAlerts } from "@/lib/digest";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (auth !== `Bearer ${expected}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDailyExpiryAlerts();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
