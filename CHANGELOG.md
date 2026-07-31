# Changelog

## Unreleased

- Clarified the Action's privacy model, read-only permissions, SHA-pinning option, and v1 beta boundaries.
- Link exact npm registry deprecation findings to a version-specific Changes.Watch package-status page, clearly labelled as automated registry data rather than editorially verified coverage.

## 1.0.4 — 2026-07-31

- Link verified catalog findings in the GitHub Job Summary directly to their Changes.Watch update cards and official sources; registry-only findings keep their registry evidence because no verified Changes.Watch card exists yet.

## 1.0.3 — 2026-07-31

- Raise the configurable registry coverage cap to 2,000 unique exact package versions so large dependency graphs can opt into a complete scan while preserving the safer default of 500.

## 1.0.2 — 2026-07-31

- Increase the default bounded npm registry coverage from 100 to 500 unique exact package versions, with a configurable `max-registry-checks` input/CLI flag (hard cap: 1,000).
- Deduplicate registry checks, use bounded concurrency, and expose checked/candidate coverage in the Action outputs and summary.

## 1.0.1 — 2026-07-31

- Use a calm blue `activity` badge in GitHub Marketplace to communicate continuous monitoring rather than a blocking warning.

## 1.0.0 — 2026-07-31

- First beta release of the privacy-first scanner CLI and GitHub Action.
- Warn-only checks for verified Changes.Watch deadlines and npm exact-version deprecation metadata.
- CI and the documented workflow use Node 24-compatible GitHub Actions v5.
