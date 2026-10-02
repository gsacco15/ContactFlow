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
      <p>We search the public web for company websites and email formats. We never open LinkedIn or any page behind a login.</p>
      <h3>What we store</h3>
      <p>
        Your list stays in your browser. Our server keeps only company domains and email formats (for 30 days, so repeat companies are cheaper) and usage counts —
        tokens and searches per request, with a hashed IP and no names.
      </p>
      <h3>Google Sheets</h3>
      <p>Signing in happens in your browser. The app can only see spreadsheets it creates, and nothing from your Google account is stored on our server.</p>
    </Doc>
  );
}

export function Terms() {
  return (
    <Doc title="Terms">
      <p>ContactFlow suggests email addresses from public patterns. They are guesses, not verified mailboxes — check before relying on them.</p>
      <p>
        You are responsible for how you contact people: follow CAN-SPAM (US) and GDPR/PECR (EU, UK) — include an unsubscribe link, use an honest sender, and keep a
        suppression list.
      </p>
      <p>Don’t use ContactFlow for spam, harassment or anything unlawful.</p>
    </Doc>
  );
}
