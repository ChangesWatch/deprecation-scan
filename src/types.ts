import { z } from "zod";

const targetSchema = z.object({
  ecosystem: z.literal("npm"),
  package: z.string().min(1).max(214),
  affectedRange: z.string().min(1).max(200),
  targetKind: z.enum(["direct", "transitive", "runtime", "cli", "build", "peer", "unknown"]),
  replacementPackage: z.string().min(1).max(214).nullable(),
});

const noticeSchema = z.object({
  id: z.string().min(1).max(400),
  title: z.string().min(1).max(500),
  announcementAt: z.string().datetime(),
  officialSourceUrl: z.string().url().max(2048),
  changesWatchUrl: z.string().url().max(2048),
  effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  lifecycleStatus: z.literal("active").nullable(),
  replacement: z.string().max(1000).nullable(),
  migrationUrl: z.string().url().max(2048).nullable(),
  packageTargets: z.array(targetSchema).max(25),
});

export const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  catalogVersion: z.string().min(1).max(200),
  notices: z.array(noticeSchema).max(10_000),
}).passthrough();

export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogNotice = z.infer<typeof noticeSchema>;
export type PackageTarget = z.infer<typeof targetSchema>;

export type Dependency = {
  name: string;
  version: string | null;
  source: string;
  relationship: "direct" | "transitive" | "unresolved";
};

export type FindingKind = "deadline_passed" | "upcoming" | "registry_deprecated";

export type Finding = {
  fingerprint: string;
  kind: FindingKind;
  package: string;
  version: string | null;
  relationship: Dependency["relationship"];
  sourceFile: string;
  title: string;
  detail: string;
  officialSourceUrl: string | null;
  changesWatchUrl: string | null;
  effectiveOn: string | null;
};

export type ScanReport = {
  schemaVersion: 1;
  scannerVersion: string;
  generatedAt: string;
  root: string;
  catalog: { version: string; generatedAt: string; source: string };
  manifests: string[];
  findings: Finding[];
  summary: {
    deadlinePassed: number;
    upcoming: number;
    deprecatedPackage: number;
    total: number;
    registryChecked: number;
    registryCandidates: number;
  };
  complete: boolean;
  warnings: string[];
};
