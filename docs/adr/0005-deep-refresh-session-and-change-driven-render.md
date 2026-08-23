# ADR 0005: Put lifecycle semantics behind a deep refresh session

- Status: Accepted
- Date: 2026-08-23

## Context

Runtime refresh behavior was previously split across `runtime-policy.ts`, `runtime-plan-executor.ts`, `runtime-refresh-session.ts`, `runtime-snapshot.ts`, and `state.ts`. The policy and executor each had one production caller and exposed an implementation recipe with many flags. Understanding one Pi event required following that recipe across several shallow modules.

The same design also requested renders after lifecycle events even when no visible fact changed.

## Decision

`RuntimeRefreshSession` is the lifecycle seam presented to runtime callers. Its interface uses semantic methods such as `modelSelect`, `turnStart`, `sessionTree`, `messageEnd`, `sessionCompact`, and `agentSettled`.

Snapshot modes, event refresh plans, usage dedupe, Model speed intent application, and ordering are private implementation details inside the refresh session. `runtime-snapshot.ts` remains the adapter from public Pi facts, and `state.ts` remains the pure visible-state mutation module.

State mutators report whether visible state changed. Ordinary lifecycle refreshes request a render only when at least one visible fact changed. Git scheduling remains independent. Config save always renders because config can alter display without changing state facts.

## Consequences

- `runtime-policy.ts` and `runtime-plan-executor.ts` are deleted.
- Runtime callers learn lifecycle operations rather than plan flags.
- Tests exercise observable refresh-session and runtime outcomes instead of implementation recipes.
- Stable turn/agent lifecycle events no longer cause redundant Glance renders.
- Adding a new lifecycle rule is localized inside `RuntimeRefreshSession`.
