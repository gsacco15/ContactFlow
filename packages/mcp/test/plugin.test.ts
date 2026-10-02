import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/tools.ts";

const dir = fileURLToPath(new URL("../../../extras/chatgpt-plugin/package/", import.meta.url));
const manifest = JSON.parse(readFileSync(`${dir}plugin.json`, "utf8"));
const ui = manifest.extensions["com.openai"].interface;

describe("ChatGPT plugin package", () => {
  it("listing fits the portal's limits", () => {
    expect(manifest.name).toMatch(/^[a-z0-9-]+$/);
    expect(ui.displayName.length).toBeLessThanOrEqual(30);
    expect(ui.shortDescription.length).toBeLessThanOrEqual(30);
    expect(ui.defaultPrompt).toHaveLength(3);
    for (const p of ui.defaultPrompt) expect(p.length).toBeLessThanOrEqual(128);
    for (const k of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) expect(ui[k]).toMatch(/^https:\/\//);
  });

  it("assets exist as 512×512 PNGs", () => {
    for (const f of [ui.logo, ui.composerIcon]) {
      const png = readFileSync(`${dir}${f.replace(/^\.\//, "")}`);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512]);
    }
  });

  it("skill names only tools the server really has; no MCP server declared (would be Desktop only)", () => {
    const skill = readFileSync(`${dir}skills/contactflow/SKILL.md`, "utf8");
    expect(skill).toMatch(/^---\nname: contactflow\ndescription: .+\n---/);
    const named = [...skill.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((n) => /^(find|get|build|check|verify|show)_/.test(n));
    expect(new Set(named)).toEqual(new Set(TOOLS.map((t) => t.name)));
    expect(existsSync(`${dir}mcp.json`) || existsSync(`${dir}.mcp.json`)).toBe(false);
  });
});
