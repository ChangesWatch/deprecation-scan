# Changes.Watch Deprecation Scan

Privacy-first npm, pnpm, and Yarn dependency checks powered by the public [Changes.Watch deprecation catalog](https://www.changes.watch/developers/deprecations-catalog).

> **Beta.** `v1` is warn-only: findings are emitted in the job summary and as GitHub annotations, but do not fail the workflow.

## GitHub Action

```yaml
name: Changes.Watch deprecation scan

on:
  pull_request:
  schedule:
    - cron: "0 8 * * 1"

permissions:
  contents: read

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: ChangesWatch/deprecation-scan@v1
        with:
          upcoming-days: 30
          fail-on: never
```

The Action reads repository files in the GitHub runner. It does not upload manifests, lockfiles, repository paths, or source code to Changes.Watch. Network requests are limited to the fixed public Changes.Watch catalog and exact-version npm registry metadata. It never runs package-manager commands or lifecycle scripts.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `path` | `.` | Repository directory to scan. |
| `config` | `.changes-watch.json` | Optional JSON config inside `path`; its bounded `upcomingWithinDays` and `includeTransitiveRegistry` values override the matching Action inputs. |
| `upcoming-days` | `30` | Upcoming deadline window. |
| `include-transitive` | `true` | Read resolved transitive dependencies from lockfiles. |
| `fail-on` | `never` | Warn-only in v1 beta. |

## Outputs

`deadline-passed-count`, `upcoming-count`, `deprecated-package-count`, `scan-complete`, and `report-path`.

`report-path` is a runner-local JSON report at `.changes-watch/deprecation-report.json`. Upload it with `actions/upload-artifact` only if your repository policy permits that.

## CLI

```bash
git clone https://github.com/ChangesWatch/deprecation-scan.git
cd deprecation-scan
npm ci
node dist/cli/index.js scan --path /path/to/project --format text
```

An npm distribution is planned; do not rely on an unpublished `npx` package name yet.

The CLI reads `package.json`, `package-lock.json`, `pnpm-lock.yaml`, and common Yarn lockfile formats. It recognizes npm/pnpm/Yarn workspace layouts within bounded traversal limits. Exact lockfile versions produce version-specific findings; manifest ranges without a lockfile remain unresolved and never produce a version-specific clean claim.

```json
{
  "schemaVersion": 1,
  "upcomingWithinDays": 30,
  "includeTransitiveRegistry": true
}
```

## Finding semantics

- `deadline_passed`: a human-verified active notice has an effective date before today and matches the exact installed package version.
- `upcoming`: a matching verified effective date falls inside `upcoming-days`.
- `registry_deprecated`: npm marks the exact installed version as deprecated.

Every catalog finding includes the official vendor source and Changes.Watch detail URL. Registry failures warn independently and do not turn a scan into a false clean result.

## Security

Please read [SECURITY.md](SECURITY.md). Do not use this tool as the sole source of security, licensing, or migration decisions; verify vendor guidance linked in each finding.

## Development

```bash
npm ci
npm run check
```

The committed `dist/` bundle is the Action runtime. Releases must rebuild it and verify a clean working tree before tagging.
