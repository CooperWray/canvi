# Security

## Reporting a vulnerability

Report security issues through this repository's Security tab → **Report a vulnerability** (GitHub private vulnerability reporting).

Include what you found, the affected path, and a safe way to reproduce it. Do not open a public issue for an unfixed vulnerability.

## How this repository is secured

This repository follows the [defense-in-depth](https://github.com/jaredwray/agentic/blob/main/skills/security/defense-in-depth-nodejs/SKILL.md) checklist. Progress is tracked in [DEFENSE_IN_DEPTH.md](./DEFENSE_IN_DEPTH.md). Measures currently in place:

- Dependencies are locked in `package-lock.json`. CI installs with `npm ci`.
- CI uses a read-only token. Actions are pinned to a commit SHA. Socket Firewall wraps `npm ci`. CI does not commit generated files back.
- Workflows are linted with zizmor on every pull request.
- The Aikido PR Checks app scans each pull request on its own (`Aikido Security: check code`).
