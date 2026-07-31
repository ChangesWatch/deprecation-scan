import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("GitHub Action contract", () => {
  it("uses Node 24, read-only defaults, and the committed bundle", async () => {
    const action = await readFile("action.yml", "utf8");
    expect(action).toContain('using: "node24"');
    expect(action).toContain("main: \"dist/action/index.js\"");
    expect(action).toContain("default: \"never\"");
    expect(action).toContain("deadline-passed-count");
    expect(action).toContain("max-registry-checks");
    expect(action).toContain("registry-checked-count");
  });

  it("keeps Action catalog access fixed to Changes.Watch", async () => {
    const action = await readFile("src/action.ts", "utf8");
    const scanner = await readFile("src/scan.ts", "utf8");
    expect(action).not.toContain("catalog-url");
    expect(action).toContain("formatFindingForSummary");
    expect(scanner).toContain("https://www.changes.watch/api/v1/deprecations/catalog.json");
    expect(scanner).toContain("https://registry.npmjs.org/");
  });
});
