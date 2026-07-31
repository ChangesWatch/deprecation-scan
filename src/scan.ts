import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import semver from "semver";
import { catalogSchema, type Catalog, type Dependency, type Finding, type ScanReport } from "./types.js";

export const CATALOG_URL = "https://www.changes.watch/api/v1/deprecations/catalog.json";
const MAX_DISCOVERY_DEPTH = 12;
const MAX_MANIFESTS = 250;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DEPENDENCIES = 5_000;
const DEFAULT_MAX_REGISTRY_LOOKUPS = 500;
const ABSOLUTE_MAX_REGISTRY_LOOKUPS = 1_000;
const REGISTRY_LOOKUP_CONCURRENCY = 8;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".cache", ".changes-watch"]);

export type ScanOptions = {
  root: string;
  configPath?: string;
  upcomingDays?: number;
  includeTransitive?: boolean;
  catalog?: Catalog;
  catalogUrl?: string;
  registryChecks?: boolean;
  maxRegistryLookups?: number;
};

export async function fetchCatalog(): Promise<Catalog> {
  const response = await fetchWithTimeout(CATALOG_URL, 10_000, { accept: "application/json" });
  if (!response.ok) throw new Error(`Changes.Watch catalog returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 5 * 1024 * 1024) {
    throw new Error("Changes.Watch catalog exceeded the 5 MiB safety limit.");
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > 5 * 1024 * 1024) throw new Error("Changes.Watch catalog exceeded the 5 MiB safety limit.");
  return catalogSchema.parse(JSON.parse(body));
}

export async function scanRepository(options: ScanOptions): Promise<ScanReport> {
  const root = resolve(options.root);
  const warnings: string[] = [];
  const config = await loadConfig(root, options.configPath ?? ".changes-watch.json", warnings);
  const upcomingDays = validateUpcomingDays(config?.upcomingWithinDays ?? options.upcomingDays ?? 30);
  const includeTransitive = config?.includeTransitiveRegistry ?? options.includeTransitive ?? true;
  const catalog = options.catalog ?? await fetchCatalog();
  const manifests = await discoverFiles(root);
  const dependencies = await loadDependencies(root, manifests, includeTransitive, warnings);
  const findings = matchCatalog(dependencies, catalog, upcomingDays, warnings);
  const maxRegistryLookups = validateRegistryLookups(options.maxRegistryLookups ?? DEFAULT_MAX_REGISTRY_LOOKUPS);

  const registry = options.registryChecks ?? true
    ? await findRegistryDeprecations(dependencies, warnings, maxRegistryLookups)
    : { findings: [], complete: true, checkedCount: 0, candidateCount: 0 };
  findings.push(...registry.findings);
  findings.sort((left, right) => left.kind.localeCompare(right.kind) || left.package.localeCompare(right.package) || (left.version ?? "").localeCompare(right.version ?? ""));

  const count = (kind: Finding["kind"]) => findings.filter((finding) => finding.kind === kind).length;
  return {
    schemaVersion: 1,
    scannerVersion: "1.0.2",
    generatedAt: new Date().toISOString(),
    root: ".",
    catalog: { version: catalog.catalogVersion, generatedAt: catalog.generatedAt, source: options.catalogUrl ?? CATALOG_URL },
    manifests: manifests.map((file) => relative(root, file).split(sep).join("/")),
    findings,
    summary: {
      deadlinePassed: count("deadline_passed"),
      upcoming: count("upcoming"),
      deprecatedPackage: count("registry_deprecated"),
      total: findings.length,
      registryChecked: registry.checkedCount,
      registryCandidates: registry.candidateCount,
    },
    complete: registry.complete,
    warnings,
  };
}

async function discoverFiles(root: string): Promise<string[]> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Scan path must be a real directory.");
  const found: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DISCOVERY_DEPTH || found.length >= MAX_MANIFESTS) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (found.length >= MAX_MANIFESTS) return;
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(path, depth + 1);
      } else if (entry.isFile() && ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"].includes(entry.name)) {
        const stat = await lstat(path);
        if (stat.size <= MAX_FILE_BYTES) found.push(path);
      }
    }
  }
  await visit(root, 0);
  return found;
}

async function loadDependencies(root: string, files: string[], includeTransitive: boolean, warnings: string[]): Promise<Dependency[]> {
  const map = new Map<string, Dependency>();
  const direct = new Set<string>();
  for (const file of files.filter((file) => file.endsWith("package.json"))) {
    const json = await readJson(file, warnings);
    if (!json) continue;
    for (const key of ["dependencies", "optionalDependencies", "devDependencies", "peerDependencies"] as const) {
      const values = asRecord(json[key]);
      for (const [name, range] of Object.entries(values)) {
        if (typeof range !== "string") continue;
        direct.add(name);
        addDependency(map, { name, version: semver.valid(range) ?? null, source: relative(root, file), relationship: semver.valid(range) ? "direct" : "unresolved" });
      }
    }
  }
  if (includeTransitive) {
    for (const file of files.filter((file) => /(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(file))) {
      const lockDependencies = file.endsWith("package-lock.json")
        ? await parsePackageLock(file, root, direct, warnings)
        : file.endsWith("pnpm-lock.yaml")
          ? await parsePnpmLock(file, root, direct, warnings)
          : await parseYarnLock(file, root, direct, warnings);
      for (const dependency of lockDependencies) addDependency(map, dependency);
    }
  }
  if (map.size > MAX_DEPENDENCIES) warnings.push(`Dependency count exceeded ${MAX_DEPENDENCIES}; additional packages were ignored.`);
  return [...map.values()].slice(0, MAX_DEPENDENCIES);
}

function addDependency(map: Map<string, Dependency>, candidate: Dependency): void {
  if (!candidate.name || map.size >= MAX_DEPENDENCIES) return;
  const key = [candidate.source, candidate.name, candidate.version ?? "unresolved"].join("\0");
  const current = map.get(key);
  if (!current || (current.relationship !== "direct" && candidate.relationship === "direct")) map.set(key, candidate);
}

async function parsePackageLock(file: string, root: string, direct: Set<string>, warnings: string[]): Promise<Dependency[]> {
  const json = await readJson(file, warnings);
  if (!json) return [];
  const packages = asRecord(json.packages);
  const values: Dependency[] = [];
  for (const [key, raw] of Object.entries(packages)) {
    if (!key.includes("node_modules/")) continue;
    const record = asRecord(raw);
    const name = packageNameFromNodeModulesPath(key);
    const version = typeof record.version === "string" && semver.valid(record.version) ? record.version : null;
    if (name && version) values.push({ name, version, source: relative(root, file), relationship: direct.has(name) ? "direct" : "transitive" });
  }
  return values;
}

async function parsePnpmLock(file: string, root: string, direct: Set<string>, warnings: string[]): Promise<Dependency[]> {
  const text = await readBounded(file, warnings);
  if (!text) return [];
  try {
    const document = asRecord(parseYaml(text));
    return Object.keys(asRecord(document.packages)).flatMap((key) => {
      const parsed = parsePnpmKey(key);
      return parsed ? [{ ...parsed, source: relative(root, file), relationship: direct.has(parsed.name) ? "direct" : "transitive" as const }] : [];
    });
  } catch {
    warnings.push(`Could not parse ${relative(root, file)}.`);
    return [];
  }
}

async function parseYarnLock(file: string, root: string, direct: Set<string>, warnings: string[]): Promise<Dependency[]> {
  const text = await readBounded(file, warnings);
  if (!text) return [];
  const result: Dependency[] = [];
  let names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\S.*:$/.test(line)) names = line.slice(0, -1).split(",").map((value) => yarnDescriptorName(value.trim().replace(/^['"]|['"]$/g, ""))).filter((value): value is string => Boolean(value));
    const version = /^\s+version\s+["']([^"']+)["']/.exec(line)?.[1];
    if (version && semver.valid(version)) for (const name of names) result.push({ name, version, source: relative(root, file), relationship: direct.has(name) ? "direct" : "transitive" });
  }
  return result;
}

function matchCatalog(dependencies: Dependency[], catalog: Catalog, upcomingDays: number, warnings: string[]): Finding[] {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + upcomingDays)).toISOString().slice(0, 10);
  const findings: Finding[] = [];
  for (const dependency of dependencies) {
    if (!dependency.version) continue;
    for (const notice of catalog.notices) {
      if (notice.lifecycleStatus !== "active") continue;
      for (const target of notice.packageTargets) {
        if (target.package !== dependency.name) continue;
        if (target.targetKind === "direct" && dependency.relationship !== "direct") continue;
        if (target.targetKind === "transitive" && dependency.relationship === "direct") continue;
        if (!safeSatisfies(dependency.version, target.affectedRange, warnings, dependency.name)) continue;
        if (!notice.effectiveOn) continue;
        const kind = notice.effectiveOn < today ? "deadline_passed" : notice.effectiveOn <= cutoff ? "upcoming" : null;
        if (!kind) continue;
        findings.push(makeFinding({ kind, dependency, title: notice.title, detail: notice.replacement ?? `Verified deprecation deadline: ${notice.effectiveOn}.`, officialSourceUrl: notice.officialSourceUrl, changesWatchUrl: notice.changesWatchUrl, effectiveOn: notice.effectiveOn, identity: notice.id }));
      }
    }
  }
  return findings;
}

type RegistryCandidate = { name: string; version: string; dependencies: Dependency[] };
type RegistryCheckResult = { findings: Finding[]; warning?: string };

async function findRegistryDeprecations(dependencies: Dependency[], warnings: string[], maxLookups: number): Promise<{ findings: Finding[]; complete: boolean; checkedCount: number; candidateCount: number }> {
  const candidates = uniqueRegistryCandidates(dependencies);
  const checkedCandidates = candidates.slice(0, maxLookups);
  let complete = true;
  if (candidates.length > maxLookups) {
    warnings.push(`Registry checks are capped at ${maxLookups} of ${candidates.length} unique resolved package versions. Set max-registry-checks to raise the bounded limit.`);
    complete = false;
  }
  const results = await mapWithConcurrency(checkedCandidates, REGISTRY_LOOKUP_CONCURRENCY, async (candidate): Promise<RegistryCheckResult> => {
    try {
      const packagePath = `${encodeURIComponent(candidate.name)}/${encodeURIComponent(candidate.version)}`;
      const response = await fetchWithTimeout(`https://registry.npmjs.org/${packagePath}`, 5_000, { accept: "application/json" });
      if (!response.ok) return { findings: [], warning: `npm registry check failed for ${candidate.name}@${candidate.version}: HTTP ${response.status}.` };
      const payload: unknown = await response.json();
      const deprecatedValue = asRecord(payload).deprecated;
      const message = typeof deprecatedValue === "string" ? deprecatedValue : null;
      return {
        findings: message
          ? candidate.dependencies.map((dependency) => makeFinding({ kind: "registry_deprecated", dependency, title: `${candidate.name}@${candidate.version} is deprecated`, detail: message.slice(0, 1_000), officialSourceUrl: `https://www.npmjs.com/package/${candidate.name}/v/${candidate.version}`, changesWatchUrl: null, effectiveOn: null, identity: `npm:${candidate.name}@${candidate.version}` }))
          : [],
      };
    } catch {
      return { findings: [], warning: `npm registry check timed out or failed for ${candidate.name}@${candidate.version}.` };
    }
  });
  const findings: Finding[] = [];
  for (const result of results) {
    findings.push(...result.findings);
    if (result.warning) {
      warnings.push(result.warning);
      complete = false;
    }
  }
  return { findings, complete, checkedCount: checkedCandidates.length, candidateCount: candidates.length };
}

function uniqueRegistryCandidates(dependencies: Dependency[]): RegistryCandidate[] {
  const candidates = new Map<string, RegistryCandidate>();
  for (const dependency of dependencies) {
    if (!dependency.version) continue;
    const key = `${dependency.name}\u0000${dependency.version}`;
    const current = candidates.get(key);
    if (current) current.dependencies.push(dependency);
    else candidates.set(key, { name: dependency.name, version: dependency.version, dependencies: [dependency] });
  }
  return [...candidates.values()].sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await task(values[index]!);
    }
  }));
  return results;
}

function makeFinding(input: Omit<Finding, "fingerprint" | "package" | "version" | "relationship" | "sourceFile"> & { dependency: Dependency; identity: string }): Finding {
  const { dependency, identity, ...rest } = input;
  return { ...rest, package: dependency.name, version: dependency.version, relationship: dependency.relationship, sourceFile: dependency.source, fingerprint: createHash("sha256").update([identity, dependency.name, dependency.version, dependency.source].join("\0")).digest("hex") };
}

async function readJson(file: string, warnings: string[]): Promise<Record<string, unknown> | null> {
  const text = await readBounded(file, warnings);
  if (!text) return null;
  try { return asRecord(JSON.parse(text)); } catch { warnings.push(`Could not parse JSON file ${file}.`); return null; }
}

async function readBounded(file: string, warnings: string[]): Promise<string | null> {
  const stat = await lstat(file);
  if (stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) { warnings.push(`Ignored unsafe or oversized file ${file}.`); return null; }
  return readFile(file, "utf8");
}

async function loadConfig(root: string, configPath: string, warnings: string[]): Promise<{ upcomingWithinDays?: number; includeTransitiveRegistry?: boolean } | null> {
  const path = resolve(root, configPath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("Config path must stay inside the scan root.");
  try {
    const text = await readBounded(path, warnings);
    if (!text) return null;
    const value = asRecord(JSON.parse(text));
    if (value.schemaVersion !== undefined && value.schemaVersion !== 1) throw new Error(".changes-watch.json schemaVersion must be 1.");
    if (value.upcomingWithinDays !== undefined && (!Number.isInteger(value.upcomingWithinDays) || (value.upcomingWithinDays as number) < 0 || (value.upcomingWithinDays as number) > 3650)) throw new Error(".changes-watch.json upcomingWithinDays must be an integer between 0 and 3650.");
    if (value.includeTransitiveRegistry !== undefined && typeof value.includeTransitiveRegistry !== "boolean") throw new Error(".changes-watch.json includeTransitiveRegistry must be boolean.");
    return { upcomingWithinDays: value.upcomingWithinDays as number | undefined, includeTransitiveRegistry: value.includeTransitiveRegistry as boolean | undefined };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error instanceof Error ? error : new Error("Could not read .changes-watch.json.");
  }
}

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function packageNameFromNodeModulesPath(value: string): string | null { const part = value.slice(value.lastIndexOf("node_modules/") + "node_modules/".length); return part.startsWith("@") ? part.split("/").slice(0, 2).join("/") : part.split("/")[0] ?? null; }
function parsePnpmKey(raw: string): Pick<Dependency, "name" | "version"> | null { const key = raw.replace(/^\//, "").replace(/\(.+$/, ""); const at = key.startsWith("@") ? key.indexOf("@", key.indexOf("/") + 1) : key.lastIndexOf("@"); const name = key.slice(0, at); const version = key.slice(at + 1); return name && semver.valid(version) ? { name, version } : null; }
function yarnDescriptorName(value: string): string | null { const at = value.startsWith("@") ? value.indexOf("@", value.indexOf("/") + 1) : value.indexOf("@"); return at > 0 ? value.slice(0, at) : null; }
function safeSatisfies(version: string, range: string, warnings: string[], name: string): boolean { try { return semver.satisfies(version, range, { includePrerelease: true }); } catch { warnings.push(`Ignored invalid catalog range ${range} for ${name}.`); return false; } }
function validateUpcomingDays(value: number): number { if (!Number.isInteger(value) || value < 0 || value > 3650) throw new Error("upcoming-days must be an integer between 0 and 3650."); return value; }
function validateRegistryLookups(value: number): number { if (!Number.isInteger(value) || value < 1 || value > ABSOLUTE_MAX_REGISTRY_LOOKUPS) throw new Error(`max-registry-checks must be an integer between 1 and ${ABSOLUTE_MAX_REGISTRY_LOOKUPS}.`); return value; }
async function fetchWithTimeout(url: string, timeoutMs: number, headers: Record<string, string>): Promise<Response> { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { return await fetch(url, { headers, redirect: "error", signal: controller.signal }); } finally { clearTimeout(timer); } }
