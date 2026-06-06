# Vicode Beta Tester Quick Start

This guide is for someone testing Vicode on Windows for the first time.

## 1. Download The App

Use the packaged Windows installer from:

- [lowluds/vicode-windows-releases](https://github.com/lowluds/vicode-windows-releases/releases)

Use the source mirror only if you want to build Vicode from source:

- [lowluds/vicode-windows-public](https://github.com/lowluds/vicode-windows-public)

## 2. Install And Launch

1. Download `Vicode-Setup-0.2.8.exe`.
2. Run the installer.
3. Launch Vicode.
4. Open a project folder to begin.

If you already downloaded `Vicode-Setup-0.2.5.exe`,
`Vicode-Setup-0.2.6.exe`, or `Vicode-Setup-0.2.7.exe`, discard it and use the
`0.2.8` installer instead once that candidate is published.

## 3. Connect A Provider

Recommended first provider:

- `Ollama` with the local Ollama runtime

Supported API-key lanes:

- `Custom API` for OpenAI-compatible API keys

Not part of the current beta scope:

- first-class `OpenAI` CLI setup
- provider-native CLI sign-in routes
- `Gemini CLI`

Parked compatibility lanes not currently surfaced in the beta UI:

- `Qwen`
- `Kimi`

Provider setup instructions:

- [Windows provider setup](../setup/windows-provider-setup.md)

For this beta line, Ollama runs through your local Ollama API. Ollama API keys
are retired. OpenAI keys should be added through `Custom API` as an
OpenAI-compatible provider, not through a first-class OpenAI CLI provider. For
OpenAI testing, use `https://api.openai.com/v1` as the compatible base URL and
the selected testing model, currently `gpt-5.4-nano` unless the test owner
provides a different model.

## 4. Run A First Test

Start with a small local project folder and ask Vicode to:

- explain a file
- make a small docs or UI change
- fix a small bug

For the initial public beta, useful feedback is whether install, first launch,
project opening, provider setup, small file explanations, small edits, bug
fixes, approvals, relaunch restore, upgrade, uninstall, and the tester docs all
behave clearly.

## 5. How Updates Work

- Installed Windows builds check for updates on launch.
- Update status also appears in `Settings > General`.
- When an update is ready, Vicode shows a visible update action in the titlebar.
- Clicking the update action restarts Vicode immediately and installs the new build, even if that interrupts the current run.

## 6. How To Report Bugs

- Use the [beta feedback form](https://github.com/lowluds/vicode-windows-public/issues/new?template=beta-feedback.yml) for first-run notes about what worked, what broke, and what felt confusing.
- Use the [bug report form](https://github.com/lowluds/vicode-windows-public/issues/new?template=bug-report.yml) for reproducible failures with exact steps.
- Pull requests are for code changes, not for reporting a broken workflow.

## 7. Current Beta Limits

These are not the main beta promise yet:

- npm end-user install
- broad collaboration claims
- full autonomous-builder claims

## 8. App Data Safety

- Vicode keeps its own local app state.
- Provider API keys are stored for Vicode on this PC.
- Vicode should not write, delete, sync, install, uninstall, or clean files
  inside another provider application's private app-state folders.

## Related Docs

- [README.md](../../README.md)
- [0.2.8 reviewer guide](./0.2.8-reviewer-guide.md)
- [0.2.8 release notes](./0.2.8.md)
- [0.2.8 public beta handoff copy](./0.2.8-public-beta-handoff.md)
