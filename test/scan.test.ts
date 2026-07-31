import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { scanRepository } from "../src/scan.js";
import type { Catalog } from "../src/types.js";

const catalog: Catalog = {
  schemaVersion: 1,
  generatedAt: "2026-07-31T10:00:00.000Z",
  catalogVersion: "sha256:test",
  notices: [{
    id: "cw-deprecation:legacy-client",
    title: "Legacy client removal",
    announcementAt: "2026-07-01T10:00:00.000Z",
    officialSourceUrl: "https://vendor.example/changelog",
    changesWatchUrl: "https://www.changes.watch/updates/legacy-client",
    effectiveOn: "2020-01-01",
    lifecycleStatus: "active",
    replacement: "Use @vendor/current-client.",
    migrationUrl: "https://vendor.example/migrate",
    packageTargets: [{ ecosystem: "npm", package: "@vendor/legacy-client", affectedRange: "<4.0.0", targetKind: "direct", replacementPackage: "@vendor/current-client" }],
  }],
};

describe("scanRepository", () => {
  it("matches exact resolved package-lock versions to verified catalog targets", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ dependencies: { "@vendor/legacy-client": "^3.0.0" } }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { "@vendor/legacy-client": "^3.0.0" } }, "node_modules/@vendor/legacy-client": { version: "3.2.1" } } }),
    });
    const report = await scanRepository({ root, catalog, registryChecks: false });
    expect(report.summary.deadlinePassed).toBe(1);
    expect(report.findings[0]).toMatchObject({ package: "@vendor/legacy-client", version: "3.2.1", relationship: "direct", kind: "deadline_passed" });
  });

  it("does not treat unresolved manifest ranges as exact installed versions", async () => {
    const root = await fixture({ "package.json": JSON.stringify({ dependencies: { "@vendor/legacy-client": "^3.0.0" } }) });
    const report = await scanRepository({ root, catalog, registryChecks: false });
    expect(report.findings).toEqual([]);
  });

  it("can skip transitive lockfile discovery", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ dependencies: { "@vendor/legacy-client": "^3.0.0" } }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/@vendor/legacy-client": { version: "3.2.1" } } }),
    });
    const report = await scanRepository({ root, catalog, includeTransitive: false, registryChecks: false });
    expect(report.findings).toEqual([]);
  });

  it("uses bounded config inside root and rejects config path traversal", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ dependencies: { "@vendor/legacy-client": "^3.0.0" } }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/@vendor/legacy-client": { version: "3.2.1" } } }),
      ".changes-watch.json": JSON.stringify({ schemaVersion: 1, includeTransitiveRegistry: false }),
    });
    const report = await scanRepository({ root, catalog, registryChecks: false });
    expect(report.findings).toEqual([]);
    await expect(scanRepository({ root, configPath: "../outside.json", catalog, registryChecks: false })).rejects.toThrow("Config path must stay inside the scan root");
  });

  it("reads pnpm and Yarn lockfile versions without executing package-manager code", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ dependencies: { "@vendor/legacy-client": "^3.0.0" } }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\npackages:\n  '@vendor/legacy-client@3.2.1': {}\n",
      "packages/web/yarn.lock": "\"@vendor/legacy-client@^3.0.0\":\n  version \"3.1.0\"\n",
    });
    const report = await scanRepository({ root, catalog, registryChecks: false });
    expect(report.summary.deadlinePassed).toBe(2);
    expect(report.findings.map((finding) => finding.version).sort()).toEqual(["3.1.0", "3.2.1"]);
  });

  it("deduplicates registry versions, reports coverage, and remains incomplete when a bounded limit is reached", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({}),
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/alpha": { version: "1.0.0" },
          "node_modules/beta": { version: "2.0.0" },
          "node_modules/gamma": { version: "3.0.0" },
          "packages/duplicate/node_modules/alpha": { version: "1.0.0" },
        },
      }),
    });
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    try {
      const report = await scanRepository({ root, catalog, maxRegistryLookups: 2 });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(report.summary).toMatchObject({ registryChecked: 2, registryCandidates: 3 });
      expect(report.complete).toBe(false);
      expect(report.warnings).toContain("Registry checks are capped at 2 of 3 unique resolved package versions. Set max-registry-checks to raise the bounded limit.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects unsafe registry lookup limits", async () => {
    const root = await fixture({ "package.json": JSON.stringify({}) });
    await expect(scanRepository({ root, catalog, registryChecks: false, maxRegistryLookups: 0 })).rejects.toThrow("max-registry-checks must be an integer between 1 and 2000.");
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "changes-watch-test-"));
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
  return root;
}
