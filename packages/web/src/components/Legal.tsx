import type { ReactNode } from "react";

export const SUPPORT_EMAIL = "support@jobpaperapp.com";

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="max-w-2xl space-y-4 text-[15px] leading-relaxed text-stone-700 [&_h3]:pt-2 [&_h3]:font-semibold [&_h3]:text-stone-900">
      <h2 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h2>
      {children}
      <p>
        Questions: <a className="font-medium text-stone-900 underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </article>
  );
}

/** What actually happens to data in this app — keep in sync with the code. */
export function Privacy() {
  return (
    <Doc title="Privacy">
      <h3>What you paste</h3>
      <p>
        Your paste is sent through our server to Anthropic’s Claude, which reads out names, titles and companies. When “Looking for” is filled in, each person’s name,
        title and company (never an email) go to TypeSafe’s Jev to judge relevance.
      </p>
      <h3>Searches</h3>
      <p>
        We search the public web for company websites and email formats, and may read a company’s own public pages (team, contact) for addresses. We never open
        LinkedIn or any page behind a login.
      </p>
      <h3>Mailbox checks</h3>
      <p>
        When verification is on, one candidate address per company is sent to our email-verification provider (MillionVerifier) to check whether that mailbox
        exists. We keep only the result for the company’s format (for example “first.last works at acme.com”), never the address or the name.
      </p>
      <h3>In ChatGPT</h3>
      <p>
        When you use ContactFlow in ChatGPT, ChatGPT sends us the names, titles and companies it read from your message so we can look them up. They pass through
        our server for that request only and aren’t stored. What ChatGPT itself keeps is covered by OpenAI’s privacy policy.
      </p>
      <h3>What we store</h3>
      <p>
        Your list stays in your browser. Our server keeps only company-level facts: domains and email formats (30 days), what we learned about each company’s format
        and where from (up to a year, so repeat lookups are cheaper and more accurate), and usage counts — tokens, searches and checks per request, with a hashed IP
        and no names.
      </p>
      <h3>Google Sheets</h3>
      <p>Signing in happens in your browser. The app can only see spreadsheets it creates, and nothing from your Google account is stored on our server.</p>
    </Doc>
  );
}

export function Terms() {
  return (
    <Doc title="Terms">
      <p>
        ContactFlow suggests email addresses from each company’s email format and the public source behind it. Only addresses marked verified (or format proven)
        were confirmed by a mailbox check; the rest are likely, not certain — check before relying on them.
      </p>
      <p>
        You are responsible for how you contact people: follow CAN-SPAM (US) and GDPR/PECR (EU, UK) — include an unsubscribe link, use an honest sender, and keep a
        suppression list.
      </p>
      <p>Don’t use ContactFlow for spam, harassment or anything unlawful.</p>
    </Doc>
  );
}

/** Support: how to reach us, report a wrong email, or ask to be removed. */
export function Support() {
  return (
    <Doc title="Support">
      <p>
        Email <a className="font-medium text-stone-900 underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
      <h3>A wrong email</h3>
      <p>Tell us the company and the address that bounced (or the right one, if you know it). We fix the company’s format so the next lookup gets it right.</p>
      <h3>Using ContactFlow in ChatGPT</h3>
      <p>
        Pick ContactFlow with @ContactFlow (or the + menu) and paste names or a LinkedIn search. If ChatGPT says the tools aren’t available, reconnect ContactFlow in
        its plugin settings.
      </p>
      <h3>Remove my company or details</h3>
      <p>ContactFlow doesn’t keep people’s names or addresses. To have a company’s stored email format removed, email us.</p>
    </Doc>
  );
}
