---
description: Run the full automated build and verification cycle
agent: build-orchestrator
---
Build $ARGUMENTS by following the Build Cycle in AGENTS.md and the
`build-cycle` skill. Run every phase in order — app tests, compile, browser
tests, eval, security — and fail the build if any phase cannot reach green.
