import type { ScanReport } from "./types.js";

export function formatTextReport(report: ScanReport): string {
  const lines = [`Changes.Watch deprecation scan: ${report.summary.total} finding(s)`];
  for (const finding of report.findings) lines.push(`${finding.kind}: ${finding.package}@${finding.version ?? "unresolved"} — ${finding.detail}`);
  if (report.warnings.length) lines.push("Warnings:", ...report.warnings.map((warning) => `- ${warning}`));
  return lines.join("\n");
}
