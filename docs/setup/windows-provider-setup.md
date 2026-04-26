# Windows Provider Setup

This is the public setup guide for the currently supported Vicode provider lanes.

Release-blocking providers:

- `OpenAI`
- `Gemini`

Supported secondary lane:

- `Ollama`

Temporarily hidden compatibility lanes in the current beta UI:

- `Qwen`
- `Kimi`

## Windows Baseline

Recommended:

- Windows 11
- Node.js 24.x for local development

Vicode is Windows-first. Command quoting, native module prep, and provider setup are all hardened for Windows workflows first.

## Distribution Path

Current external beta delivery path:

- packaged Windows installer and desktop app
- npm publish remains under audit and is not yet a supported end-user install route

## OpenAI / Codex

Recommended for:

- highest-fidelity coding workflows
- strongest benchmark path
- main release-blocking lane

Expected setup:

1. Install the Codex CLI on Windows and confirm it is on `PATH`.
2. Sign in through the Codex CLI.
3. Open Vicode and refresh providers if needed.

Current Vicode truth:

- Codex runs as a provider-owned CLI lane
- Vicode does not claim app-owned approval pauses for this lane
- an attached workspace folder is required before workspace-dependent execution
- if Vicode finds an existing Codex CLI sign-in on this machine, it shows that as a local sign-in the user may explicitly adopt; it does not silently import or sync those credentials

## Gemini

Recommended for:

- second release-blocking lane
- strong planner and coding workflows

Expected setup:

1. Install the Gemini CLI on Windows and confirm it is on `PATH`.
2. Sign in through the Gemini CLI or configure a supported API-key path when applicable.
3. Open Vicode and refresh providers if needed.

Current Vicode truth:

- Gemini runs as a provider-owned CLI lane
- Gemini keeps its own approval and sandbox boundary
- an attached workspace folder is required before workspace-dependent execution
- if Vicode finds an existing Gemini CLI sign-in on this machine, it shows that as a local sign-in the user may explicitly adopt; it does not silently import or sync those credentials
- when Vicode starts a fresh Gemini CLI sign-in, it launches Gemini's browser-based OAuth flow through a managed background CLI process instead of requiring a separate visible terminal window

## Ollama

Recommended for:

- local or hosted secondary coding lane
- app-owned runtime and approval behavior inside Vicode

Two supported routes:

### Local Ollama

1. Install Ollama for Windows.
2. Start the local runtime, or let Vicode connect to an already reachable local Ollama instance.
3. Pull or select a supported coding model.

### Hosted Ollama

1. Add an Ollama API key in Vicode settings.
2. Refresh the provider to load cloud models.

Current Vicode truth:

- Ollama is the only active production lane where Vicode owns runtime approval behavior directly
- an attached workspace folder is required before workspace-dependent execution
- workspace command and network policy apply to app-owned shell execution in this lane

## Qwen and Kimi

Current stance:

- available as compatibility-only lanes
- currently hidden from the beta provider UI
- not part of the active production optimization program
- keep install and run truth honest, but do not expect the same depth of active hardening as OpenAI, Gemini, or Ollama

Use them only if you explicitly want to probe those compatibility paths.

## Privacy and Local Sign-In

Vicode follows an explicit-adoption model for provider-owned CLI auth:

- it may detect that a supported provider CLI is already signed in on the current machine
- it does not automatically import, upload, or silently reuse that local sign-in
- the user explicitly chooses whether to adopt that existing CLI sign-in inside Vicode
- if the user prefers, they can re-run the provider's official CLI sign-in flow instead

This keeps provider credentials provider-owned and makes local sign-in reuse an intentional user action rather than an implicit background behavior.

In Settings > Providers, Vicode now keeps that behind one primary `Connect` action for CLI-backed providers:

- if a machine-local CLI sign-in is already present, `Connect` adopts it explicitly into Vicode
- if no local sign-in is present yet, `Connect` opens the provider's official CLI login flow
- manual provider CLI launch remains available as a secondary troubleshooting action, not a parallel primary path

For Gemini specifically, Vicode now forces the official Google OAuth path through Gemini CLI's documented auth settings and auto-confirms the browser handoff prompt in the background. Users should see the browser sign-in flow directly, without having to manage a separate terminal window themselves.

CLI resolution stays simple for public installs:

- Vicode first resolves the provider CLI from `PATH`
- if Vicode has already discovered a valid executable path on the current machine, it can reuse that resolved executable
- if neither exists, Vicode shows install guidance instead of asking the user to type a folder path
- normal provider setup should not require a manual directory entry for browser-based sign-in flows like Codex or Gemini

## Native Module Repair

If Electron or native dependencies drift after install:

```bash
npm run native:prepare:electron
```

For Node-side test execution:

```bash
npm run native:prepare:node
```

## Verification

Base verification:

```bash
npm test
npm run build
npm run smoke
```

Canonical deterministic desktop sweep:

```bash
npm run verify:desktop
```

Live provider validation:

```bash
npm run e2e:live
npm run validate:mixed-use
```

Packaged Windows beta handoff:

```bash
npm run dist:win
npm run smoke:packaged
npm run audit:release
npm run audit:repo-public
```
