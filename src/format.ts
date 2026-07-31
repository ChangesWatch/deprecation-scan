import type { Finding, ScanReport } from "./types.js";

export function formatTextReport(report: ScanReport): string {
  const lines = [`Changes.Watch deprecation scan: ${report.summary.total} finding(s)`];
  for (const finding of report.findings) lines.push(`${finding.kind}: ${finding.package}@${finding.version ?? "unresolved"} — ${finding.detail}`);
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
    formatHttpsLink("Open Changes.Watch package status", buildNpmPackageStatusUrl(finding)),
    formatHttpsLink("Official source", finding.officialSourceUrl),
  ].filter((link): link is string => Boolean(link));
  const suffix = links.length > 0 ? ` — ${links.join(" · ")}` : "";

  return `- **${finding.kind}** ${finding.package}@${finding.version ?? "unresolved"}: ${finding.detail}${suffix}`;
}

/**
 * Registry findings are version-specific. Their Changes.Watch destination is
 * deliberately labelled as automated registry status, not a verified card.
 */
function buildNpmPackageStatusUrl(finding: Finding): string | null {
  if (finding.kind !== "registry_deprecated" || !finding.version) return null;
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(finding.package)) return null;
  if (!/^[0-9a-z][0-9a-z._+~-]{0,199}$/i.test(finding.version)) return null;

  const packagePath = finding.package.split("/").map(encodeURIComponent).join("/");
  return `https://www.changes.watch/packages/npm/${packagePath}?version=${encodeURIComponent(finding.version)}`;
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
