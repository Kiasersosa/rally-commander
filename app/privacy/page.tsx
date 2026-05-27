import Link from "next/link";

export const metadata = {
  title: "Privacy Policy · Rally Commander",
  description:
    "Privacy policy for Rally Commander rally-team management software, including SMS messaging data handling.",
};

const UPDATED = "2026-05-27";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <Link href="/" className="rc-link text-sm">
          ← Rally Commander
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Privacy Policy
        </h1>
        <p className="rc-muted mt-1 text-sm">Last updated {UPDATED}</p>
      </header>

      <div className="rc-card space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="mb-2 text-lg font-semibold">Who we are</h2>
          <p>
            Rally Commander is rally-team management software operated by
            Jason Mesman (sole proprietor, doing business as First Response
            Tree Service). We provide tools for amateur rally racing teams to
            coordinate vehicles, equipment, safety gear, event logistics,
            documents, and communications.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">What we collect</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Account info</strong> you (or your team captain) provide:
              name, email, role, optional phone number.
            </li>
            <li>
              <strong>Team data</strong> you enter into the app: events,
              vehicles, equipment inventory, safety items, documents, bulletins,
              condition reports, and similar operational records.
            </li>
            <li>
              <strong>Files</strong> you upload (PDFs, screenshots, photos) are
              stored on Cloudflare R2 and accessed via short-lived signed URLs.
            </li>
            <li>
              <strong>Authentication tokens</strong> for magic-link or PIN login.
            </li>
            <li>
              <strong>Audit logs</strong> of notifications sent on your behalf
              (channel, recipient, status, timestamp).
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">How we use it</h2>
          <p>
            Solely to operate the service for your team: authenticate you,
            display data to authorized team members, send the notifications
            you or your team captain trigger, and retain audit trails for
            troubleshooting. We do not sell your data, and we do not share it
            with third parties for marketing or advertising purposes.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">SMS messaging</h2>
          <p>
            If you provide a phone number and toggle SMS opt-in on your profile,
            Rally Commander may send transactional SMS for the use cases below
            on the schedule chosen by your team captain:
          </p>
          <ul className="list-disc pl-6 my-2 space-y-1">
            <li>Organizer bulletins logged into the Sportity feed.</li>
            <li>Safety / license expiry alerts.</li>
            <li>Weekly digest of pending team todos.</li>
            <li>Critical event / schedule changes posted by your team captain.</li>
          </ul>
          <p>
            Phone numbers collected for SMS are used <em>only</em> to deliver
            these notifications. We do not share, rent, or sell phone numbers
            to third parties. Message frequency varies by event activity but
            typically does not exceed a few messages per active rally day.
            Message and data rates may apply per your carrier.
          </p>
          <p>
            You can opt out at any time by replying <strong>STOP</strong> to any
            message or by toggling SMS off on your{" "}
            <Link href="/profile" className="rc-link">
              /profile page
            </Link>
            . Reply <strong>HELP</strong> for assistance, or email{" "}
            <a
              href="mailto:blackdiamondsales@gmail.com"
              className="rc-link"
            >
              blackdiamondsales@gmail.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">
            Service providers we use
          </h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Fly.io</strong> — application hosting and database.
            </li>
            <li>
              <strong>Cloudflare R2</strong> — file storage.
            </li>
            <li>
              <strong>Resend</strong> — outbound email (magic links, digests,
              bulletins).
            </li>
            <li>
              <strong>Twilio</strong> — outbound SMS, where opted in.
            </li>
            <li>
              <strong>Anthropic</strong> — Claude API used to extract structured
              content from screenshots / PDFs you upload. Content is sent to the
              API for processing and not stored by the model provider beyond
              their standard logging.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Retention</h2>
          <p>
            Account, team, and operational data is retained while the team is
            active. Notification audit logs are retained for at least 12 months
            for delivery troubleshooting and compliance. Soft-deleted records
            (users, events, documents) remain in the database to preserve
            referential integrity but are excluded from all queries.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Your rights</h2>
          <p>
            Email{" "}
            <a
              href="mailto:blackdiamondsales@gmail.com"
              className="rc-link"
            >
              blackdiamondsales@gmail.com
            </a>{" "}
            to request export or deletion of your personal data. Hard deletion
            may be limited if your activity is referenced in another team
            member&apos;s historical records (audit logs, work-order history).
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Contact</h2>
          <p>
            Jason Mesman ·{" "}
            <a
              href="mailto:blackdiamondsales@gmail.com"
              className="rc-link"
            >
              blackdiamondsales@gmail.com
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
