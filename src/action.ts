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
  const report = await scanRepository({ root, configPath, upcomingDays, includeTransitive, registryChecks: true });
  const reportPath = resolve(root, ".changes-watch", "deprecation-report.json");
  await mkdir(resolve(root, ".changes-watch"), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  core.setOutput("deadline-passed-count", report.summary.deadlinePassed);
  core.setOutput("upcoming-count", report.summary.upcoming);
  core.setOutput("deprecated-package-count", report.summary.deprecatedPackage);
  core.setOutput("scan-complete", String(report.complete));
  core.setOutput("report-path", reportPath);
  await core.summary
    .addHeading("Changes.Watch deprecation scan")
    .addTable([[{ data: "Category", header: true }, { data: "Count", header: true }], ["Deadline passed", String(report.summary.deadlinePassed)], ["Upcoming", String(report.summary.upcoming)], ["Registry deprecated", String(report.summary.deprecatedPackage)]])
    .addRaw(report.findings.length ? `\n${report.findings.map((finding) => `- **${finding.kind}** ${finding.package}@${finding.version ?? "unresolved"}: ${finding.detail}`).join("\n")}` : "\nNo matching deprecations found.")
    .addRaw(`\n\nWarn-only beta. Report: \`${reportPath}\`.`)
    .write();
  for (const finding of report.findings) core.warning(`${finding.kind}: ${finding.package}@${finding.version ?? "unresolved"} — ${finding.detail}`, { file: finding.sourceFile });
  for (const warning of report.warnings) core.warning(warning);
}

run().catch((error: unknown) => core.setFailed(error instanceof Error ? error.message : String(error)));
