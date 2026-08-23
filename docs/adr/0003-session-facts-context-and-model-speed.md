# ADR 0003: Separate billed-session facts, context truth, and settled Model speed

- Status: Accepted
- Date: 2026-08-23

## Context

Pi exposes several related but non-interchangeable facts:

- persisted entries with provider usage;
- `ctx.getContextUsage()` for the active context;
- assistant stream deltas and final provider usage;
- `agent_settled` after retries, compactions, and queued continuations.

Treating one source as a substitute for another creates incorrect totals or misleading speed measurements.

## Decision

Tokens, Cost, and cache rate use a billed-session ledger containing assistant, usage-bearing tool-result, compaction, and branch-summary usage.

Context comes exclusively from `ctx.getContextUsage()`. Unknown public values remain unknown; production does not infer context from `sessionManager.getBranch()`.

Model speed uses final assistant provider output, minus reported reasoning when available, divided by measured active text/tool-call output-stream time. It excludes waiting, reasoning spans, tool execution, and inter-call gaps. `message_end` may expose a provisional measurement; only `agent_settled` finalizes it.

No message-content token estimation, timer, ticker, or notification is used.

## Consequences

- Tokens/Cost can be larger than the usage represented by Model speed.
- Compaction and tool-result costs remain visible without pretending they have matching stream timing.
- Context may temporarily display unknown after compaction.
- Full entry reconciliation is reserved for session start and structural session-tree changes; ordinary events use deltas.
