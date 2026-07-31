import type { Finding, ScanReport } from "./types.js";

export function formatTextReport(report: ScanReport): string {
  const lines = [`Changes.Watch deprecation readiness: ${report.summary.grouped} package(s), ${report.summary.total} finding(s)`];
  for (const group of report.groups) lines.push(`${group.severity}: ${group.package}@${group.version ?? "unresolved"} (${group.relationship}) — ${group.recommendation}`);
  if (report.warnings.length) lines.push("Warnings:", ...report.warnings.map((warning) => `- ${warning}`));
  return lines.join("\n");
}

/**
 * Produces Markdown for GitHub's job summary. Only HTTPS URLs are embedded so
 * untrusted catalog or registry strings cannot create an unsafe action link.
 */
export function formatFindingForSummary(finding: Finding): string {
  const links = [
    formatHttpsLink("Open Changes.Watch card", finding.changesWatchUrl),
    formatHttpsLink("Official source", finding.officialSourceUrl),
  ].filter((link): link is string => Boolean(link));
  const suffix = links.length > 0 ? ` — ${links.join(" · ")}` : "";

  return `- **${finding.kind}** ${finding.package}@${finding.version ?? "unresolved"}: ${finding.detail}${suffix}`;
}

function formatHttpsLink(label: string, value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? `[${label}](${url.toString()})` : null;
  } catch {
    return null;
  }
}
