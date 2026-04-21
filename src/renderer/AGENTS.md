# Renderer Guidance

- Treat [app.tsx](./app.tsx) as the shell coordinator, not a dumping ground for new route logic.
- Before adding feature work to oversized renderer files, run `npm run audit:maintainability` from the repo root and check the current extraction plan in [docs/engineering/maintainability-audit-2026-04-01.md](../../docs/engineering/maintainability-audit-2026-04-01.md).
- Prefer extracting pure helpers, selectors, prompt builders, and section-local presentational components before moving stateful orchestration.
- Keep one canonical owner for selected thread, project, and startup bootstrap state.
- Do not bypass `src/renderer/components/ui` for new shared controls.
- Preserve the renderer boundary: no filesystem, child-process, or raw Node access.
