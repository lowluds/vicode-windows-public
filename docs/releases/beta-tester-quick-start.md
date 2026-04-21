# Vicode Beta Tester Quick Start

This guide is for someone testing Vicode on Windows for the first time.

## 1. Download The App

Use the packaged Windows installer from:

- [lowluds/vicode-windows-releases](https://github.com/lowluds/vicode-windows-releases/releases)

Use the source mirror only if you want to build Vicode from source:

- [lowluds/vicode-windows-public](https://github.com/lowluds/vicode-windows-public)

## 2. Install And Launch

1. Download `Vicode-Setup-0.2.1.exe`.
2. Run the installer.
3. Launch Vicode.
4. Open a project folder and trust that workspace when prompted.

## 3. Connect A Provider

Recommended first providers:

- `OpenAI / Codex CLI`
- `Gemini CLI`

Supported secondary lane:

- `Ollama`

Compatibility-only lanes:

- `Qwen`
- `Kimi`

Provider setup instructions:

- [Windows provider setup](../setup/windows-provider-setup.md)

## 4. Run A First Test

Start with a small trusted project and ask Vicode to:

- explain a file
- make a small docs or UI change
- fix a small bug

## 5. How Updates Work

- Installed Windows builds check for updates on launch.
- Update status also appears in `Settings > General`.
- When an update is ready, Vicode shows a visible update action in the titlebar.
- If a run is active when you click update, Vicode queues the install and waits
  for that run to finish before restarting.

## 6. Current Beta Limits

These are not the main beta promise yet:

- npm end-user install
- broad collaboration claims
- full autonomous-builder claims

## Related Docs

- [README.md](../../README.md)
- [0.2.1 reviewer guide](./0.2.1-reviewer-guide.md)
- [0.2.1 release notes](./0.2.1.md)
