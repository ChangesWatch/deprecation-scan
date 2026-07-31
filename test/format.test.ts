import { describe, expect, it } from "vitest";
import { formatFindingForSummary } from "../src/format.js";
import type { Finding } from "../src/types.js";

const finding: Finding = {
  fingerprint: "test",
  kind: "deadline_passed",
  severity: "urgent",
  source: "verified_catalog",
  deadlineStatus: "passed",
  package: "@vendor/legacy-client",
  version: "3.2.1",
  relationship: "direct",
  sourceFile: "package-lock.json",
  dependencyPath: ["@vendor/legacy-client"],
  title: "Legacy client removal",
  detail: "Migrate to the supported client.",
  recommendation: "Upgrade to @vendor/current-client.",
  replacementPackage: "@vendor/current-client",
  migrationStrategy: "replace",
  replacementVersion: "4.0.0",
  codemodCommand: null,
  breakingChanges: null,
  migrationUrl: "https://vendor.example/migrate",
  noticeId: "cw-deprecation:legacy-client",
  officialSourceUrl: "https://vendor.example/changelog",
  changesWatchUrl: "https://www.changes.watch/updates/legacy-client",
  effectiveOn: "2026-07-01",
};

describe("formatFindingForSummary", () => {
  it("links verified findings to their Changes.Watch card and official source", () => {
    const summary = formatFindingForSummary(finding);

    expect(summary).toContain("[Open Changes.Watch card](https://www.changes.watch/updates/legacy-client)");
    expect(summary).toContain("[Official source](https://vendor.example/changelog)");
  });

  it("does not render absent or non-HTTPS URLs as Markdown links", () => {
    const summary = formatFindingForSummary({
      ...finding,
      changesWatchUrl: "javascript:alert(1)",
      officialSourceUrl: null,
    });

    expect(summary).not.toContain("Open Changes.Watch card");
    expect(summary).not.toContain("javascript:");
  });

  it("links exact registry deprecations to an explicitly labelled package status page", () => {
    const summary = formatFindingForSummary({
      ...finding,
      kind: "registry_deprecated",
      package: "@changeswatch/legacy-client",
      version: "3.2.1",
      changesWatchUrl: null,
    });

    expect(summary).toContain(
      "[Open Changes.Watch package status](https://www.changes.watch/packages/npm/%40changeswatch/legacy-client?version=3.2.1)",
    );
    expect(summary).not.toContain("Open Changes.Watch card");
  });
});
