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

  it("skill names only tools the server really has", () => {
    const skill = readFileSync(`${dir}skills/contactflow/SKILL.md`, "utf8");
    expect(skill).toMatch(/^---\nname: contactflow\ndescription: .+\n---/);
    const named = [...skill.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((n) => /^(find|get|build|check|verify|show)_/.test(n));
    expect(new Set(named)).toEqual(new Set(TOOLS.map((t) => t.name)));
  });

  it("connects to our MCP server, in both formats ChatGPT wrote (Plugin Creator 0.1.3), with matching listings", () => {
    for (const f of ["mcp.json", ".mcp.json"]) {
      const m = JSON.parse(readFileSync(`${dir}${f}`, "utf8"));
      expect(m.mcpServers.contactflow).toMatchObject({ type: "streamable-http", url: "https://contact-flow-web.vercel.app/api/mcp" });
    }
    const codex = JSON.parse(readFileSync(`${dir}.codex-plugin/plugin.json`, "utf8"));
    expect(codex.interface).toEqual(ui);
    expect([codex.name, codex.version]).toEqual([manifest.name, manifest.version]);
    expect(existsSync(`${dir}${codex.mcpServers.replace(/^\.\//, "")}`)).toBe(true);
  });
});
