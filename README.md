# Vicode

Vicode is a Windows-first desktop app for AI-assisted coding.

It is intentionally smaller than Codex, Cursor, Claude Code, or a full IDE. The goal is a focused local coding shell: open a project, start a thread, run a provider, inspect the result, and keep the workflow understandable.

Current beta candidate: `0.2.8`

Release-owner decision: ready for limited public beta.

`0.2.8` remains draft/unpublished until the release owner explicitly publishes
or shares the installer link for testers.

Public source mirror: [lowluds/vicode-windows-public](https://github.com/lowluds/vicode-windows-public)

Windows beta releases: [lowluds/vicode-windows-releases](https://github.com/lowluds/vicode-windows-releases/releases)

## What Vicode Is

Vicode is built for developers and beta testers who want a quieter AI coding app with local project state and explicit provider execution.

It currently focuses on:

- local projects, threads, and run history
- workspace trust before provider execution
- Ollama as the current release-blocking provider lane
- normalized model transports for Ollama responses, Ollama chat, and OpenAI-compatible Custom API keys
- skills and MCP integration surfaces
- diagnostics, release validation, and reproducible Windows packaging

Vicode is not trying to become a generic IDE, a plugin marketplace, an admin panel, or a Discord-style collaboration client.

## Beta Testers

Start here:

- [Beta tester quick start](./docs/releases/beta-tester-quick-start.md)
- [Current reviewer guide](./docs/releases/0.2.8-reviewer-guide.md)
- [Current release notes](./docs/releases/0.2.8.md)

Install the packaged Windows app from the release page after the matching
installer is published or shared privately by the release owner:

- [Vicode Windows releases](https://github.com/lowluds/vicode-windows-releases/releases)

Use GitHub Issues for beta feedback:

- [Share beta feedback](https://github.com/lowluds/vicode-windows-public/issues/new?template=beta-feedback.yml)
- [Report a reproducible bug](https://github.com/lowluds/vicode-windows-public/issues/new?template=bug-report.yml)
- [View open issues](https://github.com/lowluds/vicode-windows-public/issues)

Good beta reports include:

- Vicode version
- Windows version
- install path, such as installer, unpacked build, or local dev build
- provider used, such as local Ollama or Custom API with an
  OpenAI-compatible `/v1` key, base URL, and model
- which first-run checks were completed
- exact steps to reproduce
- expected behavior
- actual behavior
- screenshots, logs, or error text when available

## Contributors

Pull requests are welcome when they keep Vicode focused, Windows-safe, and easier to trust.

Before opening a PR:

1. Read [CONTRIBUTING.md](./CONTRIBUTING.md).
2. Fork the repo or create a dedicated feature branch.
3. Keep the branch narrow.
4. Update tests or docs when behavior changes.
5. Run the relevant verification commands before submitting.

For most code changes:

```bash
npm test
npm run build
```

For the full deterministic desktop sweep:

```bash
npm run verify:desktop
```

If you touch provider execution, preload, Electron startup, native dependencies, or persistence, also run:

```bash
npm run smoke
```

For packaging or release-facing changes:

```bash
npm run dist:win
npm run smoke:packaged
npm run audit:release
npm run audit:repo-public
```

Open pull requests here:

- [Create a pull request](https://github.com/lowluds/vicode-windows/compare)

## Agent Orientation

This repo is friendly to coding agents, but the project has firm boundaries.

Agents should preserve these rules:

- keep privileged work in the Electron main process
- keep preload narrow and typed
- keep renderer code unprivileged
- keep model-only providers on the normalized transport path when feasible
- keep provider-specific behavior behind provider transports or retired-provider adapters
- do not fabricate assistant output when a provider fails
- do not mark a run completed unless the provider reached a real terminal state
- do not execute retired provider-owned CLI lanes
- keep filesystem scans bounded
- do not mutate external provider app data such as the historical Codex app state under `~/.codex`

Process boundaries:

- main process: [`src/main`](./src/main)
- preload bridge: [`src/preload`](./src/preload)
- renderer UI: [`src/renderer`](./src/renderer)
- shared contracts: [`src/shared`](./src/shared)
- storage: [`src/storage`](./src/storage)
- providers: [`src/providers`](./src/providers)

Project guidance for agents:

- [AGENTS.md](./AGENTS.md)
- [Engineering source of truth](./docs/engineering/README.md)
- [Ollama listing readiness](./docs/ollama-listing-readiness/README.md)
- [Verification playbook](./docs/engineering/verification-playbook.md)
- [Windows release runbook](./docs/engineering/windows-release-runbook.md)

## Local Development

Recommended environment:

- Windows 11
- Node.js `24.x`
- npm `10+`

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

If native dependencies drift after an install or Electron change:

```bash
npm run native:prepare:electron
```

## Provider Setup

Use the Windows provider setup guide:

- [Windows provider setup](./docs/setup/windows-provider-setup.md)

Current provider stance:

- release-blocking: Ollama
- active beta API-key lane: Custom API / OpenAI-compatible keys
- normalized backend lanes: Ollama responses, Ollama chat, OpenAI-compatible Custom API chat
- retired provider CLI lanes: OpenAI/Codex, Gemini, Qwen, and Kimi keep historical IDs only for storage/schema compatibility and fail with a retired-provider message

Ollama runs through the local Ollama runtime/API for this beta route. Ollama API keys and hosted/cloud Ollama setup are retired unless the service is used through the generic OpenAI-compatible Custom API path. Local model writing is model-dependent, so broad local write-capable execution should stay caveated in public claims.

OpenAI usage should be configured through `Custom API` with an OpenAI-compatible `/v1` base URL and API key. Other API-key or cloud-model providers can be tested through the same Custom API path when they expose an OpenAI-compatible `/v1` endpoint and model. Vicode should not write, delete, sync, install, uninstall, or clean files inside another provider application's private app-state folders.

## Release And Source Distribution

The supported external beta path is the packaged Windows installer.

- Installer and updater artifacts publish through [lowluds/vicode-windows-releases](https://github.com/lowluds/vicode-windows-releases).
- Public beta source snapshots should publish through the curated mirror repo [lowluds/vicode-windows-public](https://github.com/lowluds/vicode-windows-public).
- `npm pack` and `npm publish` are not the current end-user release path.

Release references:

- [CHANGELOG.md](./CHANGELOG.md)
- [Beta tester quick start](./docs/releases/beta-tester-quick-start.md)
- [0.2.8 release notes](./docs/releases/0.2.8.md)
- [0.2.8 reviewer guide](./docs/releases/0.2.8-reviewer-guide.md)

## License

MIT
