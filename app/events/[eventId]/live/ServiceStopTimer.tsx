"use client";

import { useEffect, useState } from "react";

function fmtSeconds(total: number): string {
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${s.toString().padStart(2, "0")}`;
}

export function ServiceStopTimer({
  startedAtIso,
  plannedSeconds,
}: {
  startedAtIso: string;
  plannedSeconds: number;
}) {
  const startedAt = new Date(startedAtIso).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.floor((now - startedAt) / 1000);
  const remaining = plannedSeconds - elapsed;
  const overrun = remaining < 0;

  return (
    <div className="text-sm">
      <div
        className={`text-3xl font-bold tabular-nums ${
          overrun ? "text-rose-600" : "text-black"
        }`}
      >
        {fmtSeconds(remaining)}
      </div>
      <div className="rc-muted text-xs">
        {overrun
          ? `${fmtSeconds(elapsed)} elapsed · ${fmtSeconds(-remaining)} over`
          : `${fmtSeconds(elapsed)} elapsed of ${fmtSeconds(plannedSeconds)}`}
      </div>
    </div>
  );
}
