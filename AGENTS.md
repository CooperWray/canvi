# AGENTS.md

## Agentic conventions
- Issue tracker: Linear
- Labels: bug, enhancement, documentation, security
- ADR directory: docs/decisions/
- CHANGELOG: CHANGELOG.md
- Default branch: main
- Package manager: npm

## Security
- Defense in depth status: DEFENSE_IN_DEPTH.md
- Vulnerability reports: SECURITY.md
- Skills: `.cursor/skills/defense-in-depth-nodejs`, `.cursor/skills/security-audit`
- Aikido PR Checks scans each pull request on its own. Do not add an `aikido-api-client scan` workflow; Aikido rejects it when the PR Checks app is already installed.
