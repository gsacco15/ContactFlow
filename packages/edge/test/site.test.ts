import { describe, expect, it } from "vitest";
import { extractEmails, pickLinks, robotsAllows, sameSite, sitemapLinks } from "../supabase/functions/pipeline/lib.ts";

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
});
