# Vicode

Vicode is a Windows-first Electron desktop app for AI-assisted coding workflows.

It is intentionally smaller than Codex, Claude Code, or full IDE shells, but it is aiming at the same core bar:

- coherent local project threads
- trustworthy provider execution
- calm, premium transcript UX
- real coding workflows from prompt to changed files and verification

Release-blocking providers:

- `OpenAI`
- `Gemini`

Supported secondary lane:

- `Ollama`

Compatibility-only lanes:

- `Qwen`
- `Kimi`

## Status

Current package version:

- `0.2.1`

Current platform stance:

- Windows-first
- Electron desktop app
- local-first SQLite state

Current external beta path:

- packaged Windows installer and unpacked app are the active external handoff path
- installed Windows builds now check for desktop updates on launch
- update status is visible in `Settings > General` and in the titlebar
- when a desktop update is ready, clicking the titlebar update action queues install until the current run finishes instead of interrupting it
- desktop update artifacts publish to the public release-only repo at [lowluds/vicode-windows-releases](https://github.com/lowluds/vicode-windows-releases)
- public beta source snapshots should publish through the curated mirror repo at [lowluds/vicode-windows-public](https://github.com/lowluds/vicode-windows-public), not by making the internal working repo public directly
- npm packaging is still under audit and is not yet a supported end-user install route

If you are beta testing Vicode for the first time, start here:

- [docs/releases/beta-tester-quick-start.md](./docs/releases/beta-tester-quick-start.md)

If you are reviewing the current release line in more detail, start here:

- [docs/releases/0.2.1-reviewer-guide.md](./docs/releases/0.2.1-reviewer-guide.md)

## What Vicode Already Does

- project and thread persistence
- trusted workspace gating
- provider execution across OpenAI, Gemini, Ollama, Qwen, and Kimi
- skills and MCP integration surfaces
- run evidence, review surfaces, and transcript compaction
- collaboration is currently parked from the primary app shell while the core coding workflow is hardened
- diagnostics export and live benchmark coverage

## Requirements

Recommended development environment:

- Windows 11
- Node.js 24.x
- npm 10+

Supported development baseline right now:

- Windows only is the primary hardening target
- Node 24.x is the tested baseline for native-module and Electron workflow stability

If native dependencies drift after an install or Electron change, run:

```bash
npm run native:prepare:electron
```

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm run dev
```

3. Run the canonical deterministic desktop sweep when you want the full local gate:

```bash
npm run verify:desktop
```

4. Or run the narrower baseline:

```bash
npm test
npm run build
npm run smoke
```

## Provider Setup

Use the Windows provider setup guide:

- [docs/setup/windows-provider-setup.md](./docs/setup/windows-provider-setup.md)

That guide covers:

- OpenAI / Codex CLI
- Gemini CLI
- Ollama local and hosted modes as the supported secondary lane
- current expectations for compatibility-only Qwen and Kimi lanes

Auth/privacy model:

- Vicode can detect an existing provider CLI login on the current machine
- it does not automatically import, sync, or silently adopt that local sign-in
- the user explicitly chooses whether to use an existing CLI sign-in inside Vicode

## Verification

Core verification:

```bash
npm test
npm run build
npm run smoke
```

Canonical deterministic desktop sweep:

```bash
npm run verify:desktop
```

Deterministic UI/E2E:

```bash
npm run e2e
```

Live provider certification:

```bash
npm run e2e:live
```

Mixed-use provider validation:

```bash
npm run validate:mixed-use
```

Packaged release / beta handoff:

```bash
npm run dist:win
npm run smoke:packaged
npm run audit:release
npm run audit:repo-public
```

Published Windows update channel:

```bash
npm run release:win
```

Use that only when the release is backed by a tag or draft release in
`lowluds/vicode-windows-releases` and the required `GH_TOKEN` /
`GITHUB_TOKEN` publish credentials are available.

## Contributing

See:

- [CONTRIBUTING.md](./CONTRIBUTING.md)

## Release Notes

- [CHANGELOG.md](./CHANGELOG.md)
- [docs/releases/beta-tester-quick-start.md](./docs/releases/beta-tester-quick-start.md)
- [docs/releases/0.2.1.md](./docs/releases/0.2.1.md)
- [docs/releases/0.2.1-reviewer-guide.md](./docs/releases/0.2.1-reviewer-guide.md)

## License

MIT
