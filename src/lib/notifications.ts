// Notification send adapters (Resend for email, Twilio for SMS) + an audit-log
// helper that records every send to the `notifications` table.

import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "./db";
import {
  notifications,
  type NotificationChannel,
  type NotificationKind,
} from "./db/schema";

let _resend: Resend | undefined;
function resendClient(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set");
  _resend = new Resend(key);
  return _resend;
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER,
  );
}

/**
 * Send an SMS via Twilio. Imports lazily so the package isn't loaded when
 * SMS isn't configured (keeps cold-start small).
 */
async function sendSmsViaTwilio(
  to: string,
  body: string,
): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  if (!isTwilioConfigured()) {
    return { ok: false, error: "Twilio not configured" };
  }
  try {
    const { default: twilio } = await import("twilio");
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!,
    );
    const msg = await client.messages.create({
      to,
      from: process.env.TWILIO_FROM_NUMBER!,
      body,
    });
    return { ok: true, sid: msg.sid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendEmailViaResend(
  to: string,
  subject: string,
  body: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const from = process.env.EMAIL_FROM ?? "noreply@rallycommander.app";
    const result = await resendClient().emails.send({
      from,
      to,
      subject,
      text: body,
    });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true, id: result.data?.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type SendArgs = {
  teamId: string;
  userId: string;
  channel: NotificationChannel;
  kind: NotificationKind;
  recipient: string;
  subject: string | null;
  body: string;
};

export async function recordAndSend(args: SendArgs): Promise<{
  notificationId: string;
  delivered: boolean;
  error?: string;
}> {
  // Insert the row first as `pending`, so a crash mid-send is visible.
  const [row] = await db
    .insert(notifications)
    .values({
      teamId: args.teamId,
      userId: args.userId,
      channel: args.channel,
      kind: args.kind,
      recipient: args.recipient,
      subject: args.subject,
      body: args.body,
    })
    .returning();

  let result: { ok: boolean; error?: string };
  if (args.channel === "email") {
    const r = await sendEmailViaResend(
      args.recipient,
      args.subject ?? "Rally Commander",
      args.body,
    );
    result = r.ok ? { ok: true } : { ok: false, error: r.error };
  } else {
    const r = await sendSmsViaTwilio(args.recipient, args.body);
    result = r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  await db
    .update(notifications)
    .set({
      status: result.ok ? "sent" : "failed",
      sentAt: result.ok ? new Date() : null,
      error: result.error ?? null,
    })
    .where(eq(notifications.id, row.id))
    .catch(() => {
      /* swallow update error to avoid double-failure */
    });

  return {
    notificationId: row.id,
    delivered: result.ok,
    error: result.error,
  };
}
