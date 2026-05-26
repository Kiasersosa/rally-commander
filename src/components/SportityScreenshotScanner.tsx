"use client";

import { useState, useTransition } from "react";
import {
  scanSportityScreenshot,
  type ScanResult,
} from "@/lib/actions/scan-sportity";

type Status =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "success"; result: ScanResult }
  | { kind: "error"; message: string };

/**
 * Lives above the Sportity log form. The user picks a Sportity screenshot;
 * we send it to Claude vision for OCR, then populate the existing form
 * inputs (which are uncontrolled server-rendered <input>s) by setting
 * their .value directly. We also stuff the same file into the form's
 * file input so it ends up attached on submit.
 */
export function SportityScreenshotScanner() {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus({ kind: "scanning" });

    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const result = await scanSportityScreenshot(fd);

        applyToForm(result, file);
        setStatus({ kind: "success", result });
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Scan failed",
        });
      }
    });

    // Allow re-picking the same file
    e.target.value = "";
  }

  return (
    <div className="rc-card mb-4 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-semibold">Scan screenshot to pre-fill</label>
        {status.kind === "success" ? (
          <span className="text-emerald-700 text-xs">✓ Form populated — review below and submit</span>
        ) : status.kind === "error" ? (
          <span className="text-rose-700 text-xs">{status.message}</span>
        ) : status.kind === "scanning" ? (
          <span className="rc-muted text-xs">Reading screenshot…</span>
        ) : null}
      </div>
      <p className="rc-muted text-xs">
        Phone a screenshot of a Sportity bulletin? Drop it here and we&apos;ll
        read the text into the form. The image will also be attached to the
        item.
      </p>
      <input
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={onChange}
        disabled={pending}
        className="rc-input"
      />
    </div>
  );
}

function applyToForm(result: ScanResult, file: File) {
  if (typeof document === "undefined") return;

  // Title + body
  const titleInput = document.querySelector<HTMLInputElement>(
    'form input[name="title"]',
  );
  if (titleInput && result.title) titleInput.value = result.title;

  const bodyInput = document.querySelector<HTMLTextAreaElement>(
    'form textarea[name="body_text"]',
  );
  if (bodyInput && result.body_text) bodyInput.value = result.body_text;

  // Kind radio
  const kindRadio = document.querySelector<HTMLInputElement>(
    `form input[name="kind"][value="${result.kind}"]`,
  );
  if (kindRadio) kindRadio.checked = true;

  // File input — copy the scanned image so it gets uploaded with the form
  const fileInput = document.querySelector<HTMLInputElement>(
    'form input[name="file"]',
  );
  if (fileInput) {
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
  }

  // Open the <details> wrapper so the populated form is visible
  const details = document.querySelector<HTMLDetailsElement>(
    'main details',
  );
  if (details) details.open = true;
}
