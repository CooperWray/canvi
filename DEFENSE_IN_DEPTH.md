# Defense in Depth

Tracking against https://github.com/jaredwray/agentic/blob/main/skills/security/defense-in-depth-nodejs/SKILL.md.

Profile: website/app · public

Package manager: npm (recorded in AGENTS.md). Section 3 of the upstream catalog is pnpm. Those boxes stay open. Do not migrate to pnpm unless asked.

`lockdown-repo.sh` and `check-npmjs.sh` stay inside `.cursor/skills/defense-in-depth-nodejs/scripts/`. Do not copy them to `/scripts`. An admin runs lockdown last, from the skill, after every earlier item. The agent does not run apply mode.

## 1. Security docs
- [x] `SECURITY.md` present — contact info + "How this repository is secured" summary
- [x] `DEFENSE_IN_DEPTH.md` present (this file)

## 2. CODEOWNERS and cloud bootstrap
- [ ] `.github/CODEOWNERS` covers `/.github/`, `/.vscode/`, `/.cursor/`, `/.devcontainer/`, `/.claude/`, `/.codex/`, `/scripts/` with owners the maintainer names

Safe Chain cloud bootstrap, Codex cloud setup, Claude Code network access, and the Dev Container image pin are omitted: there is no `pnpm-lock.yaml` and no `devcontainer.json`.

## 3. Dependencies (pnpm)
npm controls in place: `package-lock.json` is committed, CI runs `npm ci`, and there is no `.github/dependabot.yml`.

- [ ] `packageManager: pnpm@11.3+` pinned in `package.json`
- [ ] 7-day cooldown: `minimumReleaseAge: 10080`, `minimumReleaseAgeStrict: true`, `minimumReleaseAgeIgnoreMissingTime: false`; no first-party `minimumReleaseAgeExclude`
- [ ] `trustPolicy: no-downgrade`; no first-party `trustPolicyExclude`
- [ ] Lifecycle scripts blocked: `strictDepBuilds: true`, `dangerouslyAllowAllBuilds: false`, `allowBuilds: {}` baseline
- [ ] `blockExoticSubdeps: true`
- [ ] Lockfile committed; CI installs with `pnpm install --frozen-lockfile`
- [ ] No `.github/dependabot.yml`; other dependency-update tools (if any) open PRs only — never auto-merge

## 4. GitHub Actions
- [x] `permissions: contents: read` (or `{}` + per-job grants) on every workflow
- [x] No `contents: write` except jobs whose purpose is mutating the repo (GitHub Release, Changesets version PR); generated output is a workflow artifact, never committed back from CI
- [x] Every action pinned to a full commit SHA (`npx actions-up`)
- [x] Every job installs Socket Firewall (`SocketDev/action` SHA-pinned, `firewall-version` pinned); `pnpm install` / `npm install` run as `sfw pnpm install` / `sfw npm install`
- [x] `.github/workflows/check-workflows.yaml` lints workflows with zizmor on every PR
- [x] Workflow `name:` and job `name:` contain no spaces (kebab-case) so they can be set as required status checks
- [x] `persist-credentials: false` on checkouts that don't push
- [x] No `pull_request_target` on workflows that run untrusted PR code
- [x] Artifact-publishing workflows disable `actions/setup-node` default caching (`package-manager-cache: false`) to prevent cache poisoning
- [ ] No npm tokens (or other registry credentials) in Actions secrets

## 6. Security tooling
- [x] Aikido runs on every build
- [ ] Aikido release gate: the release workflow's stage-publish job `needs:` a passing `scan-release`

Not applicable: website/app, no publish workflow. Section 5 is omitted for the same reason.
- [ ] Socket reviews every PR that changes dependencies

The Aikido PR Checks app scans each pull request separately and posts `Aikido Security: check code`. Do not add an `aikido-api-client scan` GitHub Action: Aikido returns 422, "This repository is already protected via the PR checks app." The default-branch dependency inventory still needs `package-lock.json` on `main`.

## 7. Repository lockdown
- [ ] Phishing-resistant 2FA (passkeys / hardware keys) on the GitHub and npm accounts (manual)
- [ ] Recovery codes stored offline in a password manager (manual)
- [ ] `lockdown-repo.sh` applied by a repo admin (never committed to this repo); `--check` with `--required-checks` and `--allowed-actions` passes (PRs required on the default branch, merges blocked unless required status checks pass, tag ruleset, immutable releases, fork-PR approval (public repos), read-only workflow tokens, Actions allowlist, secret scanning, Dependabot disabled, private vulnerability reporting (public repos))

Section 5 (npm publishing) is omitted: this is a website/app (`package.json` is `"private": true`).
