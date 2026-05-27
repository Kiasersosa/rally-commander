import Link from "next/link";

export const metadata = {
  title: "Terms of Service · Rally Commander",
  description:
    "Terms of service for Rally Commander rally-team management software, including SMS messaging terms.",
};

const UPDATED = "2026-05-27";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <Link href="/" className="rc-link text-sm">
          ← Rally Commander
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Terms of Service
        </h1>
        <p className="rc-muted mt-1 text-sm">Last updated {UPDATED}</p>
      </header>

      <div className="rc-card space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="mb-2 text-lg font-semibold">1. The service</h2>
          <p>
            Rally Commander is rally-team management software operated by
            Jason Mesman (sole proprietor, doing business as First Response
            Tree Service). It is provided as-is for amateur rally teams to
            coordinate operations. Access is granted by the team captain to
            invited crew members only.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">2. Accounts</h2>
          <p>
            Accounts are created by a team captain through the in-app invite
            flow. You are responsible for keeping your magic-link email and any
            PIN you set confidential. Notify the team captain immediately if
            you suspect unauthorized access.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">3. Acceptable use</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Do not upload content that infringes third-party rights.</li>
            <li>Do not attempt to access teams or data you have not been invited to.</li>
            <li>Do not use the service to send unsolicited communications.</li>
            <li>
              Notifications sent through Rally Commander are intended only for
              named crew members of your own team.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">4. SMS messaging terms</h2>
          <p>
            By providing a phone number and toggling SMS opt-in on your profile,
            you consent to receive transactional SMS from Rally Commander
            relating to your team&apos;s rally operations. Message types include
            organizer bulletins, safety / license expiry alerts, weekly digests,
            and event-specific schedule changes.
          </p>
          <p>
            <strong>Message frequency varies.</strong> Typical activity is a few
            messages per active rally day; you may receive zero messages between
            events.
          </p>
          <p>
            <strong>Message and data rates may apply</strong> per your mobile
            carrier&apos;s plan.
          </p>
          <p>
            <strong>To opt out:</strong> reply <strong>STOP</strong>,{" "}
            <strong>UNSUBSCRIBE</strong>, <strong>CANCEL</strong>,{" "}
            <strong>END</strong>, or <strong>QUIT</strong> to any message, or
            toggle SMS off on your{" "}
            <Link href="/profile" className="rc-link">
              /profile page
            </Link>
            . You will receive one confirmation message that opt-out has been
            processed and then no further SMS.
          </p>
          <p>
            <strong>For help:</strong> reply <strong>HELP</strong> to any
            message, or email{" "}
            <a
              href="mailto:blackdiamondsales@gmail.com"
              className="rc-link"
            >
              blackdiamondsales@gmail.com
            </a>
            .
          </p>
          <p>
            <strong>Carriers are not responsible</strong> for delayed or
            undelivered messages. Supported US carriers include AT&amp;T,
            T-Mobile, Verizon Wireless, Sprint, Boost, Cricket, MetroPCS, U.S.
            Cellular, Virgin Mobile, and Alltel.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">5. Your data</h2>
          <p>
            You retain ownership of all team data you enter or upload. By using
            the service, you grant Rally Commander a non-exclusive license to
            store, process, and display that data for the purpose of operating
            the service for your team. See the{" "}
            <Link href="/privacy" className="rc-link">
              Privacy Policy
            </Link>{" "}
            for details on data handling.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">6. AI-assisted features</h2>
          <p>
            Rally Commander uses Anthropic&apos;s Claude API to extract
            structured content (titles, summaries, body text) from screenshots
            and PDFs you upload to the Sportity-updates feature. AI-extracted
            content is not guaranteed accurate; you are responsible for
            reviewing each item before relying on it for safety- or
            schedule-critical decisions.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">7. Availability</h2>
          <p>
            The service is provided without uptime guarantees. We aim to keep
            it running but reserve the right to take it down for maintenance or
            in the event of operational issues. Plan critical event-day
            communications with offline fallbacks.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">8. Liability</h2>
          <p>
            The service is provided as-is, without warranty of any kind. To the
            maximum extent permitted by law, Rally Commander is not liable for
            indirect, incidental, or consequential damages arising from use of
            the service, including missed notifications, data loss, or
            event-day operational issues.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">9. Changes</h2>
          <p>
            We may update these terms when the service changes materially.
            Continued use after an update constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">10. Contact</h2>
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
