# Workspace Operating Guide

## Purpose

This file tells the agent how to work in this workspace.

Project:

- Name: `{{REPO_NAME}}`
- Purpose: `{{REPO_PURPOSE}}`
- Primary stack: `{{REPO_STACK}}`

## Working Style

- Prioritize `{{USER_OPTIMIZATION_PRIORITY}}`.
- Prefer `{{USER_CHANGE_STYLE}}` changes.
- Communicate in a `{{USER_COMMUNICATION_STYLE}}` style.
- Ask before `{{USER_APPROVAL_BOUNDARY}}`.

## Repo Commands

- Install: `{{REPO_INSTALL_COMMAND}}`
- Build: `{{REPO_BUILD_COMMAND}}`
- Test: `{{REPO_TEST_COMMAND}}`
- Lint: `{{REPO_LINT_COMMAND}}`

If a command is unavailable, say so explicitly and use the closest safe fallback.

## Architecture Boundaries

- Main process owns privileged filesystem access, child processes, database writes, and other sensitive operations.
- Renderer code must remain unprivileged.
- Preload is a narrow typed bridge only.
- Provider-specific behavior should stay behind provider adapters.

## Repo Constraints

- Platform emphasis: `{{REPO_PLATFORM_FOCUS}}`
- Important constraints:
  - `{{REPO_CONSTRAINT_1}}`
  - `{{REPO_CONSTRAINT_2}}`
  - `{{USER_REPO_CONSTRAINTS}}`

## Quality Bar

- Match existing repo conventions before introducing new patterns.
- Prefer small, reviewable diffs.
- Update or add tests when behavior changes.
- Run the standard verification commands when feasible.
- Do not silently bypass trust, review, or safety boundaries.

## Delivery Expectations

- Summaries should be `{{USER_SUMMARY_STYLE}}`.
- Explain what changed and why.
- Call out blockers and assumptions clearly.
- Prefer implementation over speculation once the direction is clear.
