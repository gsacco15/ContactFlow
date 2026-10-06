import { describe, expect, it } from "vitest";
import { bioLinks, extractEmails, needsLogin, parseProfilesBody, pickLinks, slugName, robotsAllows, sameSite, sitemapLinks } from "../supabase/functions/pipeline/lib.ts";

const HOME = `<html><body><nav>
  <a href="/our-team">Our Team</a> <a href="/about-us">About</a> <a href="https://acme.com/contact">Contact us</a>
  <a href="/services">Services</a> <a href="https://www.linkedin.com/company/acme">LinkedIn</a>
  <a href="/brochure.pdf">Team brochure</a> <a href="mailto:info@acme.com">Email us</a>
</nav></body></html>`;

describe("site reading helpers", () => {
  it("sameSite: domain and its subdomains only", () => {
    expect(sameSite("www.acme.com", "acme.com")).toBe(true);
    expect(sameSite("careers.acme.com", "acme.com")).toBe(true);
    expect(sameSite("notacme.com", "acme.com")).toBe(false);
  });

  it("pickLinks: internal people/contact pages, best first; no other sites, no PDFs", () => {
    const links = pickLinks(HOME, "https://acme.com/", "acme.com");
    expect(links).toEqual(["https://acme.com/our-team", "https://acme.com/about-us", "https://acme.com/contact"]);
  });

  it("sitemapLinks: bio and team URLs from sitemap.xml", () => {
    const xml = "<urlset><url><loc>https://acme.com/attorneys/sandy-morris</loc></url><url><loc>https://acme.com/blog/post-1</loc></url><url><loc>https://other.com/team</loc></url></urlset>";
    expect(sitemapLinks(xml, "acme.com")).toEqual(["https://acme.com/attorneys/sandy-morris"]);
  });

  it("robotsAllows: honours Disallow for * (longest rule wins)", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/team\n\nUser-agent: badbot\nDisallow: /";
    expect(robotsAllows(robots, "/private/x")).toBe(false);
    expect(robotsAllows(robots, "/private/team")).toBe(true);
    expect(robotsAllows(robots, "/our-team")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /", "/team")).toBe(false);
  });

  it("extractEmails: mailto, plain and obfuscated addresses at the domain, with nearby text; other domains ignored", () => {
    const html = `<div class="bio"><h3>Sandy Morris</h3><p>Partner</p><a href="mailto:smorris@acme.com">Email</a></div>
      <div><h3>Jon Pratt</h3> jpratt [at] acme [dot] com</div>
      <p>Designed by <a href="mailto:hello@webagency.io">Web Agency</a></p>
      <p>Lee Wong — lwong(at)acme.com</p>`;
    const found = extractEmails(html, "acme.com", "https://acme.com/team");
    expect(found.map((e) => e.email).sort()).toEqual(["jpratt@acme.com", "lwong@acme.com", "smorris@acme.com"]);
    expect(found.find((e) => e.email === "smorris@acme.com")!.context).toContain("Sandy Morris");
    expect(found.find((e) => e.email === "jpratt@acme.com")!.context).toContain("Jon Pratt");
  });

  it("extractEmails survives a malformed mailto escape", () => {
    expect(extractEmails('<a href="mailto:bad%E0%A4%A@acme.com">x</a> ok@acme.com', "acme.com", "p").map((e) => e.email)).toContain("ok@acme.com");
  });
});

describe("bio pages", () => {
  const TEAM = `<ul>
    <li><a href="/attorneys/kate-sedey/">Kate Sedey</a></li>
    <li><a href="https://www.acme.com/attorneys/jane-q-doe">Jane Q. Doe</a></li>
    <li><a href="/attorneys/">All attorneys</a></li>
    <li><a href="/attorneys/kate-sedey">Kate again</a></li>
    <li><a href="/practice-areas/employment-law">Employment law</a></li>
    <li><a href="/team/bio.pdf">PDF</a></li>
    <li><a href="https://other.com/attorneys/sam-lee">Elsewhere</a></li>
    <li><a href="/people/sam-lee?ref=nav">Sam Lee</a></li>
  </ul>`;

  it("finds one-person pages under people folders, same site only, no duplicates", () => {
    expect(bioLinks(TEAM, "https://acme.com/attorneys", "acme.com")).toEqual([
      "https://acme.com/attorneys/kate-sedey",
      "https://www.acme.com/attorneys/jane-q-doe",
      "https://acme.com/people/sam-lee",
    ]);
  });

  it("caps how many it returns", () => {
    expect(bioLinks(TEAM, "https://acme.com/attorneys", "acme.com", 1)).toHaveLength(1);
  });

  it("names the person from the URL", () => {
    expect(slugName("https://acme.com/attorneys/kate-sedey")).toBe("Kate Sedey");
    expect(slugName("https://acme.com/our-team/jane-q-doe/")).toBe("Jane Q Doe");
    expect(slugName("https://acme.com/practice-areas/employment-law")).toBeUndefined();
  });
});

describe("profile pages", () => {
  // Shaped like a ClubExpress member bio (nela-illinois.org): the address sits under the name.
  const bio = `<header><a href="content.aspx?page_id=31&club_id=853437&action=login">Member Login</a></header>
    <h1>Member Bio</h1><div class="name">Nicholas Bringardner</div>
    <div><a href="mailto:nbringardner@legalaidchicago.org">nbringardner@legalaidchicago.org</a> | No Published Number</div>
    <h2>Contact Information</h2><dl><dt>Member Number</dt><dd>499</dd><dt>Email Address</dt><dd>nbringardner@legalaidchicago.org</dd></dl>`;

  it("extractEmails with no domain reads any address, once, with the name nearby", () => {
    const found = extractEmails(bio, null, "https://www.nela-illinois.org/content.aspx?page_id=80&member_id=9918828");
    expect(found.map((e) => e.email)).toEqual(["nbringardner@legalaidchicago.org"]);
    expect(found[0].context).toContain("Nicholas Bringardner");
  });

  it("needsLogin spots a sign-in form, not a link to one", () => {
    expect(needsLogin(bio)).toBe(false);
    expect(needsLogin('<form><input type="password" name="pw"></form>')).toBe(true);
  });

  it("parseProfilesBody: 1–10 http(s) links, de-duplicated", () => {
    expect(parseProfilesBody({ urls: ["https://a.org/p?id=1", "https://a.org/p?id=1", "http://b.org/x"] })).toEqual(["https://a.org/p?id=1", "http://b.org/x"]);
    expect(() => parseProfilesBody({ urls: [] })).toThrow(/urls/);
    expect(() => parseProfilesBody({ urls: ["javascript:alert(1)"] })).toThrow(/invalid url/);
    expect(() => parseProfilesBody({ urls: Array.from({ length: 11 }, (_, i) => `https://a.org/${i}`) })).toThrow(/at most 10/);
  });

  it("robots.txt rules apply to the page's path and query", () => {
    const robots = "User-agent: *\nDisallow: /content.aspx?page_id=80";
    expect(robotsAllows(robots, "/content.aspx?page_id=80&member_id=1")).toBe(false);
    expect(robotsAllows(robots, "/content.aspx?page_id=78")).toBe(true);
  });
});
