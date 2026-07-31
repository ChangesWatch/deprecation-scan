#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { formatTextReport } from "./format.js";
import { scanRepository } from "./scan.js";

type Arguments = { path: string; configPath: string; format: "text" | "json"; output?: string; upcomingDays: number; includeTransitive: boolean; registryChecks: boolean; maxRegistryLookups: number };

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const report = await scanRepository({ root: args.path, configPath: args.configPath, upcomingDays: args.upcomingDays, includeTransitive: args.includeTransitive, maxRegistryLookups: args.maxRegistryLookups, registryChecks: args.registryChecks });
  const text = args.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : `${formatTextReport(report)}\n`;
  if (args.output) {
    const output = resolve(args.path, args.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, text, "utf8");
  } else process.stdout.write(text);
}

function parseArguments(values: string[]): Arguments {
  if (values[0] && values[0] !== "scan" && values[0] !== "--help" && values[0] !== "-h") throw new Error(`Unsupported command: ${values[0]}. Use changes-watch scan.`);
  if (values.includes("--help") || values.includes("-h")) {
    process.stdout.write("Usage: changes-watch scan [--path .] [--config .changes-watch.json] [--format text|json] [--output report.json] [--upcoming-days 30] [--max-registry-checks 500] [--no-transitive] [--no-registry]\n");
    process.exit(0);
  }
  const get = (name: string, fallback?: string) => { const index = values.indexOf(name); return index >= 0 ? values[index + 1] : fallback; };
  const upcomingDays = Number(get("--upcoming-days", "30"));
  if (!Number.isInteger(upcomingDays) || upcomingDays < 0 || upcomingDays > 3650) throw new Error("--upcoming-days must be an integer between 0 and 3650.");
  const maxRegistryLookups = Number(get("--max-registry-checks", "500"));
  if (!Number.isInteger(maxRegistryLookups) || maxRegistryLookups < 1 || maxRegistryLookups > 2000) throw new Error("--max-registry-checks must be an integer between 1 and 2000.");
  const format = get("--format", "text");
  if (format !== "text" && format !== "json") throw new Error("--format must be text or json.");
  return { path: get("--path", ".") ?? ".", configPath: get("--config", ".changes-watch.json") ?? ".changes-watch.json", format, output: get("--output"), upcomingDays, includeTransitive: !values.includes("--no-transitive"), registryChecks: !values.includes("--no-registry"), maxRegistryLookups };
}

main().catch((error: unknown) => { process.stderr.write(`changes-watch: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });
