// Notification send adapters (Resend for email, Twilio for SMS) + an audit-log
// helper that records every send to the `notifications` table.

import { and, eq, isNull } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "./db";
import {
  notifications,
  users,
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

export type FanOutResult = {
  emailSent: number;
  emailDelivered: number;
  smsSent: number;
  smsDelivered: number;
};

/**
 * Fan a notification out to every active crew member on a team:
 *   - email to anyone with a valid email
 *   - SMS to anyone with phone_number set AND sms_opt_in = true
 *
 * Channels are independent — opting out of SMS does not affect email delivery.
 * Every send is recorded in the notifications audit table (pending → sent / failed).
 * Returns counts for surfacing in the UI / API response.
 */
export async function fanOutToCrew(args: {
  teamId: string;
  kind: NotificationKind;
  subject: string;
  emailBody: string;
  smsBody: string;
}): Promise<FanOutResult> {
  const crew = await db
    .select({
      id: users.id,
      email: users.email,
      phoneNumber: users.phoneNumber,
      smsOptIn: users.smsOptIn,
    })
    .from(users)
    .where(and(eq(users.teamId, args.teamId), isNull(users.deletedAt)));

  // Email — every active user with a plausible email.
  const emailTargets = crew.filter(
    (c) => c.email && c.email.includes("@"),
  );
  const emailResults = await Promise.allSettled(
    emailTargets.map((c) =>
      recordAndSend({
        teamId: args.teamId,
        userId: c.id,
        channel: "email",
        kind: args.kind,
        recipient: c.email,
        subject: args.subject,
        body: args.emailBody,
      }),
    ),
  );
  const emailDelivered = emailResults.filter(
    (r) => r.status === "fulfilled" && r.value.delivered,
  ).length;

  // SMS — only users who provided a phone AND opted in.
  const smsTargets = crew.filter(
    (c) =>
      c.smsOptIn &&
      typeof c.phoneNumber === "string" &&
      c.phoneNumber.startsWith("+"),
  );
  const smsResults = await Promise.allSettled(
    smsTargets.map((c) =>
      recordAndSend({
        teamId: args.teamId,
        userId: c.id,
        channel: "sms",
        kind: args.kind,
        recipient: c.phoneNumber!,
        subject: null,
        body: args.smsBody,
      }),
    ),
  );
  const smsDelivered = smsResults.filter(
    (r) => r.status === "fulfilled" && r.value.delivered,
  ).length;

  return {
    emailSent: emailTargets.length,
    emailDelivered,
    smsSent: smsTargets.length,
    smsDelivered,
  };
}
