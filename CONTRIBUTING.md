# Contributing

## Scope

Vicode is a Windows-first Electron app. Contributions should improve the coding product without turning the app into a generic IDE, admin panel, or plugin marketplace.

## Bug Reports And Pull Requests

For beta user feedback:

- use [GitHub Issues](https://github.com/lowluds/vicode-windows-public/issues) for beta feedback, bug reports, crash notes, and reproducible user-facing problems
- use pull requests for code changes, not for reporting that the app is broken

Release-blocking providers:

- local `Ollama` runtime/API

Supported API-key lane:

- `Custom API` with an OpenAI-compatible `/v1` base URL and model

Retired setup paths for the current beta:

- first-class `OpenAI` / Codex CLI setup
- `Gemini CLI`
- `Qwen CLI`
- `Kimi CLI`
- hosted/cloud Ollama API keys

## Local Setup

Recommended environment:

- Windows 11
- Node.js 24.x
- npm 10+

Install:

```bash
npm install
```

If native dependencies drift, rebuild them for Electron:

```bash
npm run native:prepare:electron
```

Run the app:

```bash
npm run dev
```

## Branching

Use a dedicated `codex/` branch for a new cohesive task.

Examples:

- `codex/frontier-realworld-validation`
- `codex/provider-contract-hardening`

Keep branch scope narrow. Do not pile unrelated work into one branch.

## Change Discipline

- preserve process boundaries between `main`, `preload`, `renderer`, `shared`, `storage`, and `providers`
- keep providers behind adapters
- prefer minimal diffs
- do not leave duplicate feature paths behind
- remove temporary artifacts you create

## Verification

Minimum expected checks after meaningful code changes:

```bash
npm test
npm run build
```

When you want the canonical deterministic desktop sweep, prefer:

```bash
npm run verify:desktop
```

If you touched:

- provider execution
- preload
- Electron startup
- native dependencies
- persistence

also run:

```bash
npm run smoke
```

If you changed deterministic UI/workflow behavior:

```bash
npm run e2e
```

If you changed live provider certification behavior:

```bash
npm run e2e:live
```

If you changed normalized provider or Custom API validation:

```bash
npm run audit:normalized-providers
npm run certify:openai-compatible
```

If you changed packaging scripts, installer resources, shipped dependencies, or
release-facing docs:

```bash
npm run dist:win
npm run smoke:packaged
npm run audit:release
npm run audit:repo-public
```

## Provider Setup

Use:

- [docs/setup/windows-provider-setup.md](./docs/setup/windows-provider-setup.md)

## Internal Source Of Truth

Current internal operating docs live under:

- [docs/engineering/README.md](./docs/engineering/README.md)

That is the place to find:

- release program
- release gates
- verification playbook
- public launch checklist
- benchmark program
- release stabilization reset

## Pull Request Expectations

A good contribution here:

- improves reliability, UX truthfulness, packaging clarity, or coding workflow quality
- keeps the Windows-first constraints honest
- updates tests and docs when behavior changes
- leaves the repo cleaner than it found it
