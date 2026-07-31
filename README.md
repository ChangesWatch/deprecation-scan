# Changes.Watch Deprecation Scan

[![CI](https://github.com/ChangesWatch/deprecation-scan/actions/workflows/ci.yml/badge.svg)](https://github.com/ChangesWatch/deprecation-scan/actions/workflows/ci.yml)
[View on GitHub Marketplace](https://github.com/marketplace/actions/changes-watch-deprecation-scan)

Catch deprecated npm, pnpm, and Yarn dependencies before they become production
incidents. The Action combines exact registry metadata with human-verified vendor
migration deadlines from the public [Changes.Watch deprecation catalog](https://www.changes.watch/developers/deprecations-catalog).

> **Beta.** `v1` is warn-only: findings are emitted in the job summary and as GitHub annotations, but do not fail the workflow.

## Why teams install it

- **No secrets required.** The workflow needs only `contents: read`.
- **Repository files stay in the runner.** Manifests, lockfiles, paths, and source code are never uploaded to Changes.Watch.
- **Evidence over guesses.** Every catalog finding carries an official vendor source; version-specific registry findings are based on exact installed versions.

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

### Security-conscious pinning

`ChangesWatch/deprecation-scan@v1` follows the maintained v1 beta release line. If
your organization requires an immutable dependency reference, pin the verified
release commit instead:

```yaml
- uses: ChangesWatch/deprecation-scan@9293e2af1b75a8f6450f5764dbd72ec63fec89d3 # v1.0.5
```

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `path` | `.` | Repository directory to scan. |
| `config` | `.changes-watch.json` | Optional JSON config inside `path`; its bounded `upcomingWithinDays` and `includeTransitiveRegistry` values override the matching Action inputs. |
| `upcoming-days` | `30` | Upcoming deadline window. |
| `include-transitive` | `true` | Read resolved transitive dependencies from lockfiles. |
| `max-registry-checks` | `500` | Bounded maximum of unique exact package@version checks against npm (1–2000). |
| `fail-on` | `never` | Warn-only in v1 beta. |

## Outputs

`deadline-passed-count`, `upcoming-count`, `deprecated-package-count`, `urgent-count`, `high-count`, `attention-count`, `grouped-count`, `registry-checked-count`, `registry-candidate-count`, `scan-complete`, and `report-path`.

`report-path` is a runner-local JSON report at `.changes-watch/deprecation-report.json`. Upload it with `actions/upload-artifact` only if your repository policy permits that. Verified catalog findings in the GitHub Job Summary link directly to their Changes.Watch update card, where teams can assess the signal and subscribe to the affected product.

Registry lookups are deduplicated by exact package@version, run with bounded
concurrency, and default to at most 500 unique versions. If the configured
limit is reached, `scan-complete` is `false` and the summary reports
`Registry checked: checked/candidates`; it never treats partial registry
coverage as a clean result. Raise `max-registry-checks` only up to the hard
limit of 2,000.

The GitHub job summary is organized by package rather than by raw warning. Each
group includes priority, direct/transitive context, deadline status, and the
recommended next action. Coverage notes (caps, registry errors, and unresolved
sources) are shown in a separate section so they cannot be mistaken for a
deprecation finding. The JSON report includes the full finding evidence,
dependency paths, source links, and migration recommendation fields.

## CLI

```bash
git clone https://github.com/ChangesWatch/deprecation-scan.git
cd deprecation-scan
npm ci
node dist/cli/index.js scan --path /path/to/project --format text --max-registry-checks 500
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
- `registry_deprecated`: npm marks the exact installed version as deprecated. The job summary links it to a version-specific Changes.Watch package-status page labelled as automated npm data, never as a verified editorial card.

Catalog findings are prioritized as `urgent` (deadline passed), `high` (deadline
inside the configured window), or `attention` (registry deprecation). Findings
are grouped by exact package and version while preserving every source file and
dependency path in the report.

Every catalog finding includes the official vendor source and Changes.Watch detail URL. Registry failures warn independently and do not turn a scan into a false clean result.

## What this Action does not do

- It is not a vulnerability, license, or malware scanner, and does not replace `npm audit`.
- It does not create GitHub Issues, pull requests, commits, or comments.
- It does not block a workflow in the v1 public beta.
- It does not infer deprecation deadlines from package prose or report an unresolved version range as clean.

## Security

Please read [SECURITY.md](SECURITY.md). Do not use this tool as the sole source of security, licensing, or migration decisions; verify vendor guidance linked in each finding.

## Development

```bash
npm ci
npm run check
```

The committed `dist/` bundle is the Action runtime. Releases must rebuild it and verify a clean working tree before tagging.
