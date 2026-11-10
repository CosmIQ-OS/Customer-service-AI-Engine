---
name: build-cycle
description: The end-to-end automated build pipeline (implement -> app tests -> compile -> browser tests -> eval -> security -> report). Load for any build/ship/verify request.
---

## Purpose

Run the full development cycle automatically. Launch phase agents in order and
drive each to green before moving on.

## Phases

### 1. Implement
Make the requested change. Keep it minimal and scoped.

### 2. App tests (agent: `app-tester`)
- `npm test`
- `npm run typecheck`
Exit: both green.

### 3. Compile
- `npm run build`
Exit: `tsc` emits without errors.

### 4. Browser tests (agent: `browser-tester`)
- Start the server, drive the dashboard + API with Playwright.
Exit: all E2E checks pass, no console/network errors.

### 5. Eval (agent: `eval-runner`)
- `npm run eval`
Exit: baseline maintained (no regressions).

### 6. Security (agent: `security-fixer`)
- `npm audit`, semgrep, gitleaks, osv-scanner.
Exit: no high/critical findings after fixes; re-scans clean.

### 7. Report
Summarize each phase and the final verdict.

## Rules

- Launch each phase agent with the `subagent` tool and wait for it to finish.
- On failure, fix and re-run from that phase. Never skip a phase.
