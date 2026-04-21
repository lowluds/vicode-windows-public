# Main Process Guidance

- Keep main-process modules aligned to one boundary owner per concern.
- Treat [provider-manager.ts](./services/provider-manager.ts), [agent-runtime.ts](./services/agent-runtime.ts), and [vicode-build-control.ts](./services/vicode-build-control.ts) as coordinator facades; extract collaborator services before adding more unrelated logic.
- Before broad changes in oversized main-process files, run `npm run audit:maintainability` and record the next extraction slice in [docs/engineering/WORKLOG.md](../../docs/engineering/WORKLOG.md).
- Preserve Windows-safe spawning, explicit IPC validation, and provider isolation.
- Do not move renderer presentation rules or filesystem persistence details into preload or renderer as a shortcut.
