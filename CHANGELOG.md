# Changelog

All notable user-facing changes to Vicode are recorded here.

## Unreleased

### Fixed
- Fixed Ollama `/v1/responses` tool definition serialization so the local
  Ollama API receives Responses-style function tools with schema parameters
  during normalized provider validation.

### Improved
- Simplified the composer provider menu by removing the low-level Thinking
  toggle while keeping provider-owned thinking defaults in the runtime.

### Documentation
- Added the `0.2.8` public-beta verification goal with the 12 manual checks,
  automation-backed walkthrough coverage, and the remaining final
  human/outside-tester judgement gate.
- Refreshed the current `0.2.8` release-readiness docs after the final
  post-retirement packaged/install/live-provider candidate pass.
- Merged the latest beta-readiness fixes from `main` into the public-beta
  candidate, rebuilt the installer, and refreshed package/install/draft-release
  evidence for the merged source.
- Rebuilt and re-recorded current-commit `0.2.8` package, upgrade, fresh
  install, installed smoke, and uninstall evidence after wiring the beta
  walkthrough into `npm run simulate:real-user`.
- Removed the stale `codex:upstream-check` release-hardening hook and refreshed
  the `0.2.8` package, install, and draft release asset evidence for the new
  candidate commit.
- Added limited-public-beta handoff copy for Reddit-style tester invites,
  including provider scope, unsigned-installer caveats, feedback prompts, and
  release-link placeholders.
- Recorded the draft `v0.2.8` release asset state in the release-only repo
  without treating draft asset URLs as public tester links.
- Updated beta provider scope to the local Ollama API plus Custom API
  OpenAI-compatible keys, retiring first-class OpenAI and other provider CLI
  setup from public-beta gates and tester-facing docs.
- Marked the old manual packaged certification packet as historical `0.2.7`
  evidence so it is not mistaken for current `0.2.8` proof.
- Added the public-beta verification goal to the public-repo safety audit.

### Changed
- Surfaced provider setup now centers local Ollama and Custom API; retired
  provider CLI lanes fail closed instead of launching OpenAI, Gemini, Qwen, or
  Kimi CLIs.

## 0.2.8 - 2026-06-04

### Improved
- Composer edit-mode controls now use clearer release-facing language for direct edits, proposed changes, isolated worktrees, and full-access warning copy.
- Direct edits, proposed changes, and isolated worktree modes now have focused front-facing Playwright coverage so the composer/thread evidence matches the selected edit mode.
- Ollama beta positioning now centers the local Ollama API, with OpenAI keys
  supported through the OpenAI-compatible Custom API lane.

### Documentation
- Ollama listing readiness docs now keep upstream `ollama launch vicode`, local write-capable model execution, and candidate-specific proof as separate release claims.
- Release-facing docs now point testers and reviewers at the `0.2.8` beta line.

### Packaging
- App version updated to `0.2.8`.
- The Windows installer artifact for this line is `Vicode-Setup-0.2.8.exe`.
- Previous `0.2.7` packaged and installed proof is historical evidence only;
  the post-merge `0.2.8` candidate has refreshed packaged, installed,
  public-audit, automation-backed 12-check, upgrade, uninstall, local Ollama,
  and focused Custom API evidence.

## 0.2.7 - 2026-04-26

### Fixed
- Packaged Windows builds now ship the Vicode icon as an external runtime resource so the installed app, window metadata, and Windows shell surfaces do not fall back to a blank icon.

### Packaging
- App version updated to `0.2.7`.
- `0.2.7` supersedes `0.2.6` for public-beta downloads because `0.2.6` could show a blank desktop/taskbar icon even though the executable still contained an embedded icon.
- Release artifact audit now fails if the packaged runtime icon resources are missing.

## 0.2.6 - 2026-04-26

### Fixed
- Vicode now treats the OpenAI Codex app's local home as a separate application boundary. Vicode no longer writes, deletes, syncs, installs, or cleans files inside the operator's real `~/.codex` app folders.
- Build Control and repo-local automation helpers no longer default to the operator's real Codex SQLite database, automation folders, worktrees, or skill folders. Persistent Codex-backed validation must use an explicit isolated Codex home.

### Documentation
- Beta and engineering docs now explain the Codex/Vicode storage boundary so testers know Vicode should not mutate their Codex app state.
- Public source mirror scripts now include the current release notes and reviewer guide for the active beta line.

### Packaging
- App version updated to `0.2.6`.
- `0.2.6` is the next patch line for public-beta safety hardening before broader tester handoff.

## 0.2.5 - 2026-04-25

### Improved
- Downloaded desktop updates now restart Vicode immediately when the user clicks the titlebar or Settings action, instead of waiting for the current run to finish.
- Settings now includes a direct GitHub Issues link so beta testers can file bug reports from inside the app.

### Packaging
- App version updated to `0.2.5`.
- `0.2.5` is the next patch line for public-beta update and feedback polish.

## 0.2.4 - 2026-04-21

### Improved
- Windows installed-app listings now keep the product name as `Vicode` instead of appending the version to the visible app title.
- Workspace bootstrap, attachment, runtime-policy, and tool-copy surfaces now talk about the workspace directly instead of exposing the old trust terminology.
- Legacy projects with a stale `trusted = false` flag are automatically normalized during migration so upgraded installs behave like fresh installs.

### Fixed
- All attached project folders now behave as ready-to-use workspaces by default; OpenAI, Gemini, Ollama, Qwen, and Kimi no longer block runs behind a separate workspace-trust toggle.
- Workspace bootstrap is now available whenever a real folder is attached, without a separate trust step in the header or sidebar.
- Installed fresh starts remain completely empty until the user opens a folder, with no seeded `My Project` placeholder and no pre-created left-rail thread state.
- NSIS install metadata now removes the Windows Apps `DisplayVersion` entry so the Settings Apps surface no longer shows the build number as part of the installed-app listing.

### Packaging
- App version updated to `0.2.4`.
- The Windows installer artifact for this line is `Vicode-Setup-0.2.4.exe`.
- `0.2.4` replaces the earlier `0.2.3` beta build as the current Windows tester line.

## 0.2.3 - 2026-04-21

### Improved
- Brand-new installs now open directly into the shell with an empty project rail and the empty thread hero ready to open a local folder.
- The titlebar `Plugins` and `Settings` buttons now behave as true toggles and switch cleanly between surfaces instead of layering stale views.
- The left-sidebar project overflow menu now keeps only the thread-management actions that still earn space during beta.

### Fixed
- Folderless placeholder projects can no longer route workspace-dependent prompts into fake `/workspace` path answers; Vicode now blocks those runs and tells the user to attach a real folder first.
- Legacy seeded `My Project` placeholders with no folder and no saved chats are removed during migration so upgraded installs can recover into the clean shell.
- Packaged Windows builds now boot through a guarded Electron entrypoint and ship the missing startup dependency that previously left `0.2.2` hanging without a window.
- The Electron smoke gate now validates the actual blank-shell beta startup plus the updated Settings/Plugins toggle behavior.

### Packaging
- App version updated to `0.2.3`.
- Windows installer and unpacked release artifacts were rebuilt and revalidated for the `0.2.3` corrective beta line.
- `0.2.3` replaces the broken `0.2.2` tester build.

## 0.2.2 - 2026-04-21

### Improved
- Composer height now stays compact for short prompts and expands only when the draft actually needs more space.
- Provider API key settings now keep trimmed saved values, clear local drafts when auth is removed, and add explicit show/hide handling with Ollama helper actions.
- The current beta UI now consistently surfaces only the release-blocking provider set plus the supported Ollama lane.
- Public beta docs now point testers at the corrected `0.2.2` installer line in the release-only repo.

### Fixed
- Windows release packaging now audits the shipped `better_sqlite3.node` against the prepared Electron-target binary so a Node ABI artifact cannot ship unnoticed.
- `npm run release:win` now runs the same native Electron prep/build path as `npm run dist:win`, which prevents the black-screen startup failure caused by the withdrawn `0.2.1` installer.

### Packaging
- App version updated to `0.2.2`.
- Windows installer and unpacked release artifacts were rebuilt for the `0.2.2` testing line.
- `0.2.2` replaces the withdrawn `0.2.1` Windows installer release.

## 0.2.1 - 2026-04-18

### Added
- Collaboration now uses the guest-room room/session model for room-code entry and direct-chat creation.
- Collaboration now supports first-class direct-chat creation from shared contacts, backed by a guest-room Supabase RPC and a dedicated direct-chat room/session path.

### Improved
- Windows release validation now includes a packaged-app smoke path that launches the built `win-unpacked` executable and verifies startup, trusted-project creation, thread restore, archive/restore, and Integrations navigation before release.
- Installed Windows builds now check GitHub Releases for updates on launch and from `Settings > General`.
- The public Windows release feed now passes a real installed-app `0.2.0 -> 0.2.1` desktop update drill.
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
