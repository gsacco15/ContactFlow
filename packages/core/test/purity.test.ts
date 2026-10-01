import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(dir + f).isDirectory() ? files(`${dir}${f}/`) : [dir + f]));

describe("core purity", () => {
  it("imports nothing from React, Deno, Supabase or Node", () => {
    for (const f of files(src)) {
      const imports = [...readFileSync(f, "utf8").matchAll(/^(?:import|export)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
      for (const i of imports) expect(i, `${f} imports ${i}`).toMatch(/^\.\.?\//);
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\bDeno\.|process\.env|localStorage|linkedin\.com\/(in|company)/);
    }
  });

  it("schemas.ts is import-free (copied verbatim into the edge function)", () => {
    expect(readFileSync(src + "schemas.ts", "utf8")).not.toMatch(/^import /m);
  });
});
