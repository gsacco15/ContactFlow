import { describe, expect, it } from "vitest";
import { cleanPaste } from "../src/index.ts";

// Shaped like a real LinkedIn "People" search paste (names are made up).
const PAGE = `0 notifications

Search

Home
Network
Jobs
15
Messaging
6
Notifications


Me

For Business
Retry Premium for $0


People

Harbor & Pine Legal, LLC

1st

2nd

3rd+

Locations

All filters
Reset
Dana Whitlock
Dana Whitlock • 3rd+

Paralegal

Gladstone, Michigan, United States

Message
Oren Castellano (He/Him) • 3rd+

Senior Attorney at Harbor & Pine Legal, LLC

Greater Chicago Area

Message
LinkedIn Member

Legal Assistant at Harbor & Pine Legal, LLC

View
Priya Natarajan • 2nd
View Priya Natarajan’s profile
2nd degree connection
Managing Partner at Harbor & Pine Legal, LLC · priya@harborpine.com

Connect

Previous

1

2

3

Next

About

Accessibility

Help Center

Privacy & Terms

Ad Choices

LinkedIn Corporation © 2026

Grant SaccoStatus is online
MessagingYou are on the messaging overlay. Press enter to open the list of conversations.
15

Compose message
Page inboxes
Click to see affiliated inboxes`;

const PEOPLE = ["Dana Whitlock", "Oren Castellano", "Priya Natarajan", "Paralegal", "Senior Attorney at Harbor & Pine Legal, LLC", "Managing Partner at Harbor & Pine Legal, LLC"];

describe("cleanPaste", () => {
  it("recognises LinkedIn and keeps every person, title and company", () => {
    const r = cleanPaste(PAGE);
    expect(r.packs).toEqual(["linkedin"]);
    for (const p of PEOPLE) expect(r.text).toContain(p);
    expect(r.text).toContain("priya@harborpine.com"); // never-remove
    expect(r.text).toContain("Greater Chicago Area");
  });

  it("drops menus, buttons, footer, messaging overlay and connection badges", () => {
    const t = cleanPaste(PAGE).text;
    for (const junk of ["Notifications", "For Business", "Retry Premium", "All filters", "Message\n", "Connect", "Accessibility", "LinkedIn Corporation", "messaging overlay", "Compose message", "• 3rd+", "degree connection", "(He/Him)", "View Priya"]) {
      expect(t).not.toContain(junk);
    }
    expect(t.split("\n").filter((l) => /^\d+$/.test(l))).toEqual([]); // page numbers / badge counts
    expect(t.match(/Dana Whitlock/g)).toHaveLength(1); // name printed twice → once
    expect(t.length).toBeLessThan(PAGE.length * 0.6);
  });

  it("removes the same page pasted several times", () => {
    const once = cleanPaste(PAGE).text;
    const thrice = cleanPaste([PAGE, PAGE, PAGE].join("\n\n")).text;
    expect(thrice.match(/Oren Castellano/g)).toHaveLength(1);
    expect(thrice.length).toBeLessThan(once.length * 1.2);
  });

  it("skips 'People also viewed' style sections (other companies)", () => {
    const t = cleanPaste(`${PAGE}\n\nPages people also viewed\nInsideTracker page logo\nInsideTracker\nWellness and Fitness Services\n18,445 followers\n\nFollow\nShow all\n\nRosa Delgado • 3rd+\nFirm Administrator`).text;
    expect(t).not.toContain("InsideTracker");
    expect(t).not.toContain("Wellness");
    expect(t).toContain("Rosa Delgado");
    expect(t).toContain("Firm Administrator");
  });

  it("leaves non-LinkedIn text alone apart from safe universal rules", () => {
    const notes = "Acme (acme.com) — Jane Doe, VP Sales\nBeta Corp — need CFO\n\n\n\nMessage\nConnect\nPartner\nJobs";
    const r = cleanPaste(notes);
    expect(r.packs).toEqual([]);
    // "Message", "Jobs" etc. could be data elsewhere — only LinkedIn's pack removes them.
    expect(r.text).toBe("Acme (acme.com) — Jane Doe, VP Sales\nBeta Corp — need CFO\n\nMessage\nConnect\nPartner\nJobs");
  });

  it("universal rules: cookie banners, copyright lines and letter-less lines go; emails and URLs always stay", () => {
    const r = cleanPaste("Skip to main content\nAccept all cookies\nOur Team\nSam Lee — Partner\n•••\n2026\n© 2026 Acme LLP. All rights reserved.\ncontact: sam@acme.com\nhttps://acme.com/team");
    expect(r.text).toBe("Our Team\nSam Lee — Partner\ncontact: sam@acme.com\nhttps://acme.com/team");
  });

  it("never strips most of an unrecognised paste (safety cap)", () => {
    const odd = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\nZed";
    expect(cleanPaste(odd).text).toBe(odd);
  });

  it("keeps two different people who share a title", () => {
    const t = cleanPaste("Ann Lee\nPartner\n\nBo Chen\nPartner\n\nCy Park\nPartner").text;
    expect(t.match(/Partner/g)).toHaveLength(3);
  });
});
