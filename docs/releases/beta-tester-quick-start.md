# Vicode Beta Tester Quick Start

This guide is for someone testing Vicode on Windows for the first time.

## 1. Download The App

Use the packaged Windows installer from:

- [lowluds/vicode-windows-releases](https://github.com/lowluds/vicode-windows-releases/releases)

Use the source mirror only if you want to build Vicode from source:

- [lowluds/vicode-windows-public](https://github.com/lowluds/vicode-windows-public)

## 2. Install And Launch

1. Download `Vicode-Setup-0.2.6.exe`.
2. Run the installer.
3. Launch Vicode.
4. Open a project folder to begin.

If you already downloaded `Vicode-Setup-0.2.5.exe`, discard it and use the
`0.2.6` installer instead.

## 3. Connect A Provider

Recommended first providers:

- `OpenAI / Codex CLI`
- `Gemini CLI`

Supported secondary lane:

- `Ollama`

Parked compatibility lanes not currently surfaced in the beta UI:

- `Qwen`
- `Kimi`

Provider setup instructions:

- [Windows provider setup](../setup/windows-provider-setup.md)

## 4. Run A First Test

Start with a small local project folder and ask Vicode to:

- explain a file
- make a small docs or UI change
- fix a small bug

## 5. How Updates Work

- Installed Windows builds check for updates on launch.
- Update status also appears in `Settings > General`.
- When an update is ready, Vicode shows a visible update action in the titlebar.
- Clicking the update action restarts Vicode immediately and installs the new build, even if that interrupts the current run.

## 6. How To Report Bugs

- Use [GitHub Issues](https://github.com/lowluds/vicode-windows/issues) for bug reports and reproducible beta feedback.
- Pull requests are for code changes, not for reporting a broken workflow.

## 7. Current Beta Limits

These are not the main beta promise yet:

- npm end-user install
- broad collaboration claims
- full autonomous-builder claims

## 8. App Data Safety

Vicode and the OpenAI Codex app are separate applications.

- Vicode keeps its own local app state.
- Vicode can detect provider CLI setup when needed.
- Vicode should not write, delete, sync, install, uninstall, or clean files
  inside your real Codex app folders under `~/.codex`.

## Related Docs

- [README.md](../../README.md)
- [0.2.6 reviewer guide](./0.2.6-reviewer-guide.md)
- [0.2.6 release notes](./0.2.6.md)
