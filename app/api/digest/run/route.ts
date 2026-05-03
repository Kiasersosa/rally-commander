// Weekly digest cron entrypoint. Authenticated by a shared CRON_SECRET in
// the Authorization header (Bearer ...). GitHub Actions hits this on a
// weekly schedule. Returns a JSON summary.

import { runWeeklyDigests } from "@/lib/digest";

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
    const summaries = await runWeeklyDigests();
    return Response.json({
      ok: true,
      sent: summaries.filter((s) => s.delivered).length,
      failed: summaries.filter((s) => !s.delivered).length,
      total: summaries.length,
      summaries,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
