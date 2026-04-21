# Changelog

All notable user-facing changes to Vicode are recorded here.

## Unreleased

### Improved
- Downloaded desktop updates now surface as a visible titlebar action, and choosing the update during an active run queues installation until the run finishes instead of restarting immediately.
- Public beta docs now include a quick-start path, and source distribution is moving through a curated public mirror instead of the internal working repo.

## 0.2.1 - 2026-04-18

### Added
- Collaboration now uses the guest-room room/session model for room-code entry and direct-chat creation.
- Collaboration now supports first-class direct-chat creation from shared contacts, backed by a guest-room Supabase RPC and a dedicated direct-chat room/session path.

### Improved
- Windows release validation now includes a packaged-app smoke path that launches the built `win-unpacked` executable and verifies startup, trusted-project creation, thread restore, archive/restore, and Integrations navigation before release.
- Installed Windows builds now check GitHub Releases for updates on launch and from `Settings > General`.
- Live-provider certification failures now include the last raw provider events in Playwright output, which makes OpenAI and Gemini release-gate failures easier to diagnose.
- Collaboration verification now includes deterministic direct-chat coverage in service, storage, and Electron UI tests, plus explicit manual certification expectations for direct-message creation.

### Fixed
- The Electron smoke harness no longer waits for the removed in-thread workspace-bootstrap suggestion panel, so startup validation matches the current shipped UI.
- The packaged Windows path no longer stops at generated update metadata; it now has app-side updater wiring.

### Packaging
- App version updated to `0.2.1`.
- Windows installer and unpacked release artifacts were rebuilt for the `0.2.1` testing line.
- Desktop update artifacts now target the public release-only repo `lowluds/vicode-windows-releases` instead of the private source repo.

## 0.2.0 - 2026-03-17

### Added
- Durable workspace context loading for project instruction and memory files such as `AGENTS.md`, `USER.md`, `SOUL.md`, `MEMORY.md`, and daily notes.
- Workspace bootstrap flow for trusted projects, including repo inspection, draft generation, review, and write-to-workspace.
- Review-first post-bootstrap curation flows for daily notes, durable memory promotion, and `USER.md` suggestions.
- Durable jobs, review queue, and recurring automation wakeups with explicit review surfaces in the app.
- Main-process MCP foundation with curated official integrations, including supported setup flows for `shadcn MCP` and `Playwright MCP`.
- Official starter-pack and integrations surfaces in Skills, with curated official recommendations and MCP detail previews.

### Improved
- Skill resolution now runs canonically in the main process and persists correctly across retry and planner flows.
- Memory indexing and retrieval now preserve durable source recency and align better with the documented workspace-memory model.
- Automations are more durable and inspectable, with clearer review, schedule, and pending-work visibility.
- Bootstrap and review UI are clearer about project scope, proposed file contents, and approval state.

### Fixed
- Phase-alignment gaps across the durable-agent roadmap, including review-state consistency, recurring wake loss, and non-durable skill resolution.
- MCP security and readiness issues, including renderer secret exposure and immediate untrusted server launch.
- Post-bootstrap memory review drift so proposed writes are inspectable before approval and durable memory avoids session-log formatting.
- `npm run dev` Electron startup failures caused by `better-sqlite3` ABI mismatches by preparing the Electron build automatically before dev/preview.
- Recurring `better-sqlite3` ABI flip-flops between Electron and Vitest by caching runtime-specific native binaries and preparing the correct target before test and smoke flows.

### Packaging
- App version updated to `0.2.0`.
- Windows installer and unpacked release artifacts were rebuilt for the `0.2.0` testing line.

## 0.1.1 - 2026-03-16

### Added
- Gemini provider quota and reset status in Settings.
- Runtime model discovery improvements so provider model lists stay closer to the installed CLIs.
- Native spellcheck suggestions for editable fields via right-click context menu.
- A branded boot/loading surface and a new empty-thread hero with subtle animated beams.

### Improved
- Gemini provider usage UI is more compact and polished.
- The landing page is more centered and visually intentional.
- Empty threads now use a Vicode-specific build surface instead of a generic card.
- Sidebar navigation for Skills and Automations now doubles as a back action when active.
- Skills in transcripts render more clearly as inline icon-and-label badges.

### Fixed
- Gemini quota parsing and display reliability.
- Composer `$skill` mention behavior, inline highlighting, and text/caret alignment.
- Suggested skill cards now open detail modals instead of jumping directly to repository URLs.
- Gemini extension details now fall back to `README.md` when richer docs exist there.
- Windows release packaging updated to `0.1.1`.

### Packaging
- Windows installer and unpacked release artifacts were rebuilt for `0.1.1`.
- Windows executable metadata was updated for the `0.1.1` release line.
