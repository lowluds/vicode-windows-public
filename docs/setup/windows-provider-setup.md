# Windows Provider Setup

This is the public setup guide for the currently supported Vicode provider lanes.

Release-blocking provider lane:

- `Ollama`

Supported API-key lane:

- `Custom API` / OpenAI-compatible keys

Retired provider CLI lanes, hidden from the current beta provider surface:

- `OpenAI / Codex`
- `Gemini`
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

## Custom API / OpenAI-Compatible Keys

Recommended for:

- OpenAI-compatible `/v1` API providers
- OpenAI API keys when the tester has an OpenAI model they want to use
- app-owned Custom API provider setup without a provider-native CLI install

Expected setup:

1. Open `Settings > Providers`.
2. Add a `Custom API` provider.
3. Enter the OpenAI-compatible `/v1` base URL.
4. Save the API key and default model.
5. Refresh providers and select the saved Custom API model in the composer.

For OpenAI testing, use:

- base URL: `https://api.openai.com/v1`
- current operator test model: `gpt-5.4-nano`

Current Vicode truth:

- OpenAI/Codex CLI setup is retired for this beta route
- OpenAI-compatible API-key runs use the Custom API provider lane
- Vicode owns approvals and app-runtime tooling for this lane
- an attached workspace folder is required before workspace-dependent execution

## Ollama

Recommended for:

- primary local coding lane for the current narrow beta
- app-owned runtime and approval behavior inside Vicode

### Local Ollama

1. Install Ollama for Windows.
2. Start the local runtime, or let Vicode connect to an already reachable local Ollama instance.
3. Pull or select a supported coding model.

Remote or self-hosted local runtime:

- Vicode currently supports a non-default local Ollama base URL through `VICODE_OLLAMA_BASE_URL`.
- Set the environment variable before launching Vicode, for example `VICODE_OLLAMA_BASE_URL=http://127.0.0.1:11434`.
- There is no dedicated Settings field for this yet; use the environment path for beta validation and remote-runtime troubleshooting.

Context guidance:

- For coding-agent tasks, [Ollama recommends](https://docs.ollama.com/context-length) at least `64000` context tokens when the model and hardware can support it.
- For local models, set the context length in the Ollama app or start Ollama with `OLLAMA_CONTEXT_LENGTH=64000 ollama serve`.
- Use `ollama ps` to verify the allocated context and processor split before treating a local model as certified for larger coding workflows.

Model capability labels:

- Ollama model labels such as `tools`, `thinking`, `vision`, `code`, and `cloud` are useful setup hints, not Vicode certification labels.
- `tools` means a model is worth probing through Vicode's tool loop; it does not prove file-writing in the app.
- `vision` means a model may be suitable for image attachment workflows; it does not imply code-editing or write support.
- Current G5 evidence lives in [Ollama model capability matrix](../ollama-listing-readiness/model-capability-matrix.md). Keep local write-capable claims caveated until a repeatable app-level drill passes.

Current Vicode truth:

- Ollama is the only active production lane where Vicode owns runtime approval behavior directly
- Ollama API keys and hosted/cloud Ollama setup are retired for this beta route
- an attached workspace folder is required before workspace-dependent execution
- workspace command and network policy apply to app-owned shell execution in this lane

## Retired Provider CLI Lanes

Current stance:

- hidden from the beta provider UI
- not part of public setup guidance
- not release-blocking
- retained only as historical provider IDs for old state/schema compatibility

This includes OpenAI/Codex CLI, Gemini, Qwen, and Kimi. Old runs on these lanes should fail with a clear retired-provider message rather than trying to launch a provider CLI.

## Privacy and Local Sign-In

Vicode follows an app-owned credential model for the current beta lanes:

- Custom API keys are saved inside Vicode for this PC
- local Ollama uses the local runtime
- Ollama API keys are retired for this beta route
- retired provider CLI sign-ins are not a public setup path

This keeps beta setup focused on Ollama and OpenAI-compatible API keys.

Vicode should not write, delete, sync, install, uninstall, or clean files inside another provider application's private app-state folders.

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
npm run certify:openai-compatible
```

Packaged Windows beta handoff:

```bash
npm run dist:win
npm run smoke:packaged
npm run audit:release
npm run audit:repo-public
```
