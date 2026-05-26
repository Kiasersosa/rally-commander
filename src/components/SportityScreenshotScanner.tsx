"use client";

import { useRef, useState, useTransition } from "react";
import {
  scanSportityScreenshot,
  scanAndCreateSportityItems,
  type ScanResult,
} from "@/lib/actions/scan-sportity";

type Status =
  | { kind: "idle" }
  | { kind: "scanning"; total: number }
  | { kind: "single_filled"; result: ScanResult }
  | {
      kind: "batch_done";
      created: number;
      failed: number;
      notifyRequested: boolean;
      notifyDelivered: boolean;
    }
  | { kind: "error"; message: string };

/**
 * Sits above the manual log form on /events/[id]/sportity-updates.
 *
 * - One screenshot picked → OCR the image and populate the manual form
 *   below for review (legacy single-item flow).
 * - Multiple screenshots picked → call the batch action, which OCRs each
 *   in parallel, creates one sportity_item per file, and (if Notify is
 *   checked) fires a single summary email to the crew. Page revalidates;
 *   items appear in the feed below for review/delete.
 */
export function SportityScreenshotScanner({ eventId }: { eventId: string }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [notify, setNotify] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    setStatus({ kind: "scanning", total: files.length });

    startTransition(async () => {
      try {
        if (files.length === 1) {
          const fd = new FormData();
          fd.append("file", files[0]);
          const result = await scanSportityScreenshot(fd);
          applyToForm(result, files[0]);
          setStatus({ kind: "single_filled", result });
        } else {
          const fd = new FormData();
          fd.append("event_id", eventId);
          if (notify) fd.append("notify", "on");
          for (const f of files) fd.append("files", f);
          const result = await scanAndCreateSportityItems(fd);
          setStatus({
            kind: "batch_done",
            created: result.created,
            failed: result.failed,
            notifyRequested: result.notifyRequested,
            notifyDelivered: result.notifyDelivered,
          });
        }
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Scan failed",
        });
      }
    });

    // Allow re-picking the same files
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="rc-card mb-4 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-semibold">
          Scan screenshot{status.kind === "scanning" && status.total > 1 ? "s" : ""} to log updates
        </label>
        {renderStatus(status)}
      </div>
      <p className="rc-muted text-xs">
        Pick <strong>one</strong> screenshot to pre-fill the form below and review.
        Pick <strong>multiple</strong> to log each as its own item automatically
        (great for clearing a backlog at a service stop). Each image is also
        attached to its item.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        onChange={onChange}
        disabled={pending}
        className="rc-input"
      />
      <label className="inline-flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
          disabled={pending}
          className="h-3.5 w-3.5"
        />
        <span>
          Notify crew when batch-uploading multiple screenshots (one summary email)
        </span>
      </label>
    </div>
  );
}

function renderStatus(status: Status) {
  switch (status.kind) {
    case "idle":
      return null;
    case "scanning":
      return (
        <span className="rc-muted text-xs">
          {status.total === 1
            ? "Reading screenshot…"
            : `Reading ${status.total} screenshots…`}
        </span>
      );
    case "single_filled":
      return (
        <span className="text-emerald-700 text-xs">
          ✓ Form populated — review below and submit
        </span>
      );
    case "batch_done": {
      const bits: string[] = [];
      bits.push(
        `✓ ${status.created} item${status.created === 1 ? "" : "s"} created`,
      );
      if (status.failed > 0) {
        bits.push(`${status.failed} failed`);
      }
      if (status.notifyRequested) {
        bits.push(
          status.notifyDelivered ? "crew notified" : "notify failed (check email config)",
        );
      }
      const tone =
        status.failed > 0 || (status.notifyRequested && !status.notifyDelivered)
          ? "text-amber-700 text-xs"
          : "text-emerald-700 text-xs";
      return (
        <span className={tone}>
          {bits.join(" · ")} — scroll down to review
        </span>
      );
    }
    case "error":
      return <span className="text-rose-700 text-xs">{status.message}</span>;
  }
}

function applyToForm(result: ScanResult, file: File) {
  if (typeof document === "undefined") return;

  const titleInput = document.querySelector<HTMLInputElement>(
    'form input[name="title"]',
  );
  if (titleInput && result.title) titleInput.value = result.title;

  const summaryInput = document.querySelector<HTMLInputElement>(
    'form input[name="summary"]',
  );
  if (summaryInput && result.summary) summaryInput.value = result.summary;

  const bodyInput = document.querySelector<HTMLTextAreaElement>(
    'form textarea[name="body_text"]',
  );
  if (bodyInput && result.body_text) bodyInput.value = result.body_text;

  const kindRadio = document.querySelector<HTMLInputElement>(
    `form input[name="kind"][value="${result.kind}"]`,
  );
  if (kindRadio) kindRadio.checked = true;

  const fileInput = document.querySelector<HTMLInputElement>(
    'form input[name="file"]',
  );
  if (fileInput) {
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
  }

  const details = document.querySelector<HTMLDetailsElement>("main details");
  if (details) details.open = true;
}
