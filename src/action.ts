import * as core from "@actions/core";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scanRepository } from "./scan.js";

async function run(): Promise<void> {
  const root = resolve(core.getInput("path") || ".");
  const configPath = core.getInput("config") || ".changes-watch.json";
  const failOn = core.getInput("fail-on") || "never";
  if (failOn !== "never") throw new Error("Beta v1 is warn-only; fail-on must be never.");
  const upcomingDays = Number(core.getInput("upcoming-days") || "30");
  const includeTransitive = (core.getInput("include-transitive") || "true").toLowerCase() === "true";
  const maxRegistryLookups = Number(core.getInput("max-registry-checks") || "500");
  const report = await scanRepository({ root, configPath, upcomingDays, includeTransitive, maxRegistryLookups, registryChecks: true });
  const reportPath = resolve(root, ".changes-watch", "deprecation-report.json");
  await mkdir(resolve(root, ".changes-watch"), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  core.setOutput("deadline-passed-count", report.summary.deadlinePassed);
  core.setOutput("upcoming-count", report.summary.upcoming);
  core.setOutput("deprecated-package-count", report.summary.deprecatedPackage);
  core.setOutput("urgent-count", report.summary.urgent);
  core.setOutput("high-count", report.summary.high);
  core.setOutput("attention-count", report.summary.attention);
  core.setOutput("grouped-count", report.summary.grouped);
  core.setOutput("registry-checked-count", report.summary.registryChecked);
  core.setOutput("registry-candidate-count", report.summary.registryCandidates);
  core.setOutput("scan-complete", String(report.complete));
  core.setOutput("report-path", reportPath);
  const groupedRows = report.groups.length
    ? report.groups.slice(0, 100).map((group) => [
      `${severityLabel(group.severity)} ${group.package}@${group.version ?? "unresolved"}`,
      `${group.relationship} · ${group.deadlineStatus}`,
      formatRecommendation(group),
    ])
    : [["No matching deprecations", "—", "No action required."]];
  await core.summary
    .addHeading("Changes.Watch deprecation readiness")
    .addTable([
      [{ data: "Priority", header: true }, { data: "Count", header: true }],
      ["Urgent · deadline passed", String(report.summary.urgent)],
      ["High · deadline upcoming", String(report.summary.high)],
      ["Attention · registry deprecated", String(report.summary.attention)],
      ["Grouped packages", String(report.summary.grouped)],
    ])
    .addHeading("What needs attention", 3)
    .addTable([
      [{ data: "Dependency", header: true }, { data: "Context", header: true }, { data: "Recommended next action", header: true }],
      ...groupedRows.map((row) => row.map((value) => ({ data: escapeMarkdown(value) }))),
    ])
    .addHeading("Coverage and scan notes", 3)
    .addRaw(`Registry metadata checked: ${report.summary.registryChecked}/${report.summary.registryCandidates}.\n\n${report.warnings.length ? report.warnings.map((warning) => `- ${escapeMarkdown(warning)}`).join("\n") : "No coverage warnings."}`)
    .addRaw("\n\nWarn-only beta. The machine-readable report remains available through the `report-path` output.")
    .write();
  for (const finding of report.findings) core.warning(`${finding.title}: ${sanitizeAnnotation(finding.recommendation)} — ${sanitizeAnnotation(finding.detail)}`, { file: finding.sourceFile });
  for (const warning of report.warnings) core.notice(sanitizeAnnotation(warning));
}

function severityLabel(severity: "urgent" | "high" | "attention"): string {
  return severity === "urgent" ? "URGENT" : severity === "high" ? "HIGH" : "ATTENTION";
}

function formatRecommendation(group: { recommendation: string; migrationStrategies: string[]; codemodCommands: string[]; breakingChanges: string[] }): string {
  const parts = [group.recommendation];
  if (group.migrationStrategies.length) parts.push(`Strategy: ${group.migrationStrategies.join(", ")}`);
  if (group.codemodCommands.length) parts.push(`Codemod: ${group.codemodCommands[0]}`);
  if (group.breakingChanges.length) parts.push(`Breaking changes: ${group.breakingChanges[0]}`);
  return parts.join(" ");
}

function escapeMarkdown(value: string): string {
  const markdownCharacters = new Set(["\\", "`", "*", "_", "{", "}", "[", "]", "(", ")", "#", "+", "-", ".", "!", "|", ">"]);
  return [...value].map((character) => markdownCharacters.has(character) ? `\\${character}` : character).join("").slice(0, 1_000);
}

function sanitizeAnnotation(value: string): string {
  return value.replace(/[\r\n]/g, " ").slice(0, 1_000);
}

run().catch((error: unknown) => core.setFailed(error instanceof Error ? error.message : String(error)));
