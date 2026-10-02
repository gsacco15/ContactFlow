---
name: contactflow
description: Find work email addresses for people with ContactFlow. Use when the user pastes names (a LinkedIn search, a team or leadership page, attendee lists, notes, a list of firms) and wants their emails, asks for someone's work email, asks how a company formats its email addresses, or wants verified emails for outreach.
---

# Finding work emails with ContactFlow

ContactFlow finds work emails and tells you how sure to be about each one. Two tools:

- `find_emails` — names and companies in, emails out.
- `get_email_format` — "how does Acme write its emails?"

## If the tools aren't available

If `find_emails` isn't in your tools, the ContactFlow app isn't connected in this chat. Don't look
for emails another way (web search, guessing from patterns): tell the user to connect it — in
ChatGPT, Settings → Apps → ContactFlow (Developer mode), or pick ContactFlow from the + menu in
this chat — and stop there.

## Reading what the user pasted

Read the paste yourself and pull out, for each person: first name, last name, title, current company,
and the company's website if it appears. Skip anonymous rows ("LinkedIn Member"), shared inboxes
(info@, sales@) and anyone the user said they don't want. Use the current employer, not past ones
("ex-Dropbox"). If the user says who they're after ("partners, not associates"), pass it as
`looking_for`.

If the user names companies but no people ("the CFO at Beta Corp"), pass `companies` with `roles`.

## Calling find_emails

- At most 3 companies per call. For more, make several calls; parallel is fine.
- Only set `verify: true` when the user asks for verified or confirmed emails — it costs a little extra.
- Calls take 10–60 seconds; say you're looking things up.

## Presenting results

Show a table: **Name · Title · Email · Verified · Source**. Then one line per company with its
email format and where it came from.

The `verified` field decides how you describe an email:

| verified | Say |
|---|---|
| `yes` | Confirmed by a mailbox check. |
| `format proven` | The company's format was confirmed with a colleague's mailbox; this address follows it. |
| `accept-all server` | The company accepts any address, so this one can't be confirmed. Likely, not certain. |
| `no (bounced)` | This address doesn't exist. Offer the backups. |
| `not checked` | Likely, based on the company's format and its source. Not confirmed. |

Never call an email confirmed unless it says `yes` or `format proven`. Never make up an address
or a format, and never fill gaps by guessing. If a company has no email, say why (the note says).

## Boundaries

- Don't pass linkedin.com links as company websites, and don't ask ContactFlow to open LinkedIn.
- Remind users sending cold email to follow the rules where they are (CAN-SPAM in the US,
  GDPR/PECR in the EU and UK): an honest sender, an unsubscribe link, and a suppression list.
