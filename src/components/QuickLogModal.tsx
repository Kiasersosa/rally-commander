"use client";

import { useRef, useState, useTransition } from "react";

type EventOption = { id: string; name: string };

const RATING_LABELS = ["1 great", "2", "3 ok", "4", "5 bad"];

export function QuickLogModal({
  events,
  action,
}: {
  events: EventOption[];
  action: (formData: FormData) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [fatigue, setFatigue] = useState<number | null>(null);
  const [hydration, setHydration] = useState<number | null>(null);
  const [temp, setTemp] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (events.length === 0) return null;

  function reset() {
    setFatigue(null);
    setHydration(null);
    setTemp(null);
    setError(null);
    formRef.current?.reset();
  }

  function open() {
    setError(null);
    dialogRef.current?.showModal();
  }

  function close() {
    reset();
    dialogRef.current?.close();
  }

  async function onSubmit(formData: FormData) {
    setError(null);
    if (fatigue !== null) formData.set("fatigue", String(fatigue));
    if (hydration !== null) formData.set("hydration", String(hydration));
    if (temp !== null) formData.set("temp", String(temp));
    startTransition(async () => {
      try {
        await action(formData);
        close();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to log");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="rc-btn rc-btn-primary text-xs px-3 py-1.5"
        title="Log driver + car condition"
      >
        Quick log
      </button>
      <dialog
        ref={dialogRef}
        className="rc-dialog"
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
      >
        <div className="rc-dialog-inner">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Driver + car condition</h2>
              <p className="rc-muted text-xs">
                Tap once. Co-driver fills this in transit. Visible to whole crew.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="rc-btn rc-btn-ghost text-xs px-2 py-1"
            >
              ✕
            </button>
          </div>

          <form ref={formRef} action={onSubmit} className="flex flex-col gap-3">
            {events.length === 1 ? (
              <input type="hidden" name="event_id" value={events[0].id} />
            ) : (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">Event</span>
                <select name="event_id" required className="rc-select">
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <RatingRow
              label="Fatigue"
              hint="1 = fresh, 5 = exhausted"
              value={fatigue}
              onChange={setFatigue}
            />
            <RatingRow
              label="Hydration"
              hint="1 = well hydrated, 5 = parched"
              value={hydration}
              onChange={setHydration}
            />
            <RatingRow
              label="Temp"
              hint="1 = comfortable, 5 = too hot/cold"
              value={temp}
              onChange={setTemp}
            />

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Car concerns</span>
              <textarea
                name="car_concerns"
                rows={2}
                placeholder="e.g., vibration over 80mph, soft brake pedal, intermittent warning light"
                className="rc-textarea"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Notes (optional)</span>
              <input
                name="notes"
                placeholder="anything else"
                className="rc-input"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Where (optional)</span>
              <input
                name="location"
                placeholder="e.g., between SS3 and SS4, in service B"
                className="rc-input"
              />
            </label>

            {error ? (
              <p className="text-sm text-rose-600">{error}</p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={close}
                className="rc-btn rc-btn-ghost text-sm"
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rc-btn rc-btn-primary text-sm"
                disabled={pending}
              >
                {pending ? "Logging…" : "Log report"}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}

function RatingRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">{label}</span>
        <span className="rc-muted text-xs">{hint}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(active ? null : n)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors min-w-[2.75rem] ${
                active
                  ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                  : "text-[var(--foreground)] bg-[var(--surface)] border-[var(--border-strong)] hover:border-[var(--accent)]"
              }`}
              aria-label={`${label} ${RATING_LABELS[n - 1]}`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
