# pi-glance Context

## Purpose

pi-glance is a calm **Pi input-surface extension**. It decorates Pi's existing editor with a rounded frame, workspace title, and a compact status line, and exposes `/glance` for display configuration.

It is not an independent terminal UI, dashboard framework, Pi theme manager, or replacement editor implementation.

## Domain language

- **Input surface** — the Pi-owned editor area plus the Glance frame and inline status facts around it.
- **Glance state** — the in-memory, render-ready facts consumed by the input surface.
- **Billed-session facts** — usage and cost accumulated across every persisted Pi session entry that carries provider usage.
- **Context truth** — Pi's current public `ctx.getContextUsage()` result. `null` means unknown and is not inferred from another source.
- **Model speed** — provider-reported non-reasoning output divided by measured active text/tool-call output-stream time for the settled logical run.
- **Ambient tone** — `light`, `dark`, or `unknown`, derived only from the exact public Pi theme name.
- **Theme slot** — the configured Glance palette selected for a light or dark ambient tone.
- **Refresh session** — `RuntimeRefreshSession`, the deep module that owns lifecycle-to-state refresh semantics, usage dedupe, Model speed tracking, Git scheduling intent, and render decisions.

## Product responsibilities

pi-glance owns:

- the Glance editor frame and status line;
- always-on adaptive segment fitting;
- the `/glance` settings pane, bounded theme browser, and transient density preview;
- injected Pi selection keybindings and hierarchy-preserving pane navigation;
- six display features: Git, Cost, Model speed, Context, Tokens, and Model;
- its 22 curated Glance palettes;
- asynchronous cached Git status collection;
- the global config at `~/.pi/agent/pi-glance/config.json`;
- migration and validation of known config fields;
- atomic config replacement and conservative load diagnostics.

Pi owns:

- editor text editing, history, autocomplete, cursor behavior, selection, IME, and app keybindings;
- terminal/fullscreen layout and footer dock allocation;
- the current model, thinking level, model scope, session lifecycle, and context calculation;
- extension loading order and the single custom-editor slot;
- Pi UI themes and theme switching.

## Non-goals

Do not add or revive:

- Pi core/TUI patches or private deep imports;
- a standalone/fullscreen Glance TUI;
- fixed editor regions implemented outside Pi public seams;
- generic duck-typed wrapping of arbitrary third-party editors;
- Pi theme enumeration, installation, switching, or token-color rendering;
- terminal background queries, ANSI inspection, or fuzzy light/dark inference;
- render-time filesystem, process, or network work;
- Model speed token estimation from text/content length;
- Model speed timers, tickers, or notifications;
- production `sessionManager.getBranch()` reads;
- assistant-owned npm publication or credential collection.

## Runtime architecture

```text
index.ts
  -> runtime.ts                     Pi wiring and input-surface ownership
       -> RuntimeRefreshSession     lifecycle semantics and render decisions
            -> runtime-snapshot.ts  public Pi facts -> Glance inputs
            -> state.ts             pure visible-state mutations
            -> ModelSpeedRunTracker settled logical-run measurement
       -> GitRefresher              asynchronous cached Git adapter

GlanceEditor
  -> input-surface-frame.ts
       -> status-line.ts
            -> segment-registry.ts
                 -> *-segment-feature.ts

/glance
  -> pane.ts
       -> pane-model.ts
       -> settings-catalog.ts
       -> renderer.ts -> input-surface-frame.ts
```

`runtime.ts` must remain orchestration-focused. It must not absorb state mutation, session usage accounting, or frame composition.

`RuntimeRefreshSession` exposes semantic lifecycle methods such as `modelSelect`, `sessionTree`, `messageEnd`, and `agentSettled`. Snapshot plans and ordering are implementation details, not caller-visible interfaces.

## Refresh and render rules

- `session_start` and structural `session_tree` may reconcile full persisted entries.
- Ordinary lifecycle events use public lifecycle snapshots and event deltas; they do not rescan all entries.
- Compaction usage comes from `SessionCompactEvent.compactionEntry`.
- Assistant/tool-result usage comes from `message_end` deltas and is deduplicated by stable public IDs when available.
- Context always comes from `ctx.getContextUsage()`.
- Git scheduling is independent from render decisions.
- Ordinary lifecycle events request a render only when visible Glance state changes.
- Blocking `ui_prompt_start` / `ui_prompt_end` spans pause Model speed timing without requesting a render.
- Config save always requests a render because display configuration can change without changing session facts.
- Git snapshots request a render only when visible Git facts change; timestamp-only updates remain silent.

## `/glance` interaction rules

- Navigation follows category → setting → value. Enter/Right descends one level; Esc/Left ascends one level without changing the selected parent.
- Vertical selection movement, paging, confirmation, and cancellation use the `KeybindingsManager` injected into `ctx.ui.custom()`.
- Ctrl-C remains an unconditional pane cancel; extension-specific save/reset/reorder/density keys remain local commands.
- The theme catalog remains complete, but `SelectList` renders only a terminal-height-aware 4–8 row viewport.
- `GlanceConfigPane` translates input into model intents itself rather than calling `SelectList.handleInput()`, preserving the injected keybinding boundary on Pi 0.84.
- Preview density cycles through Auto, Full, Compact, and Minimal without entering `GlanceConfig` or dirty comparison.

## Session fact semantics

Tokens and Cost use the whole persisted billed-session ledger:

- assistant messages;
- usage-bearing tool results;
- compaction entries;
- branch-summary entries.

Cache rate uses the same aggregate prompt ledger:

```text
cacheRead / (input + cacheRead + cacheWrite)
```

Context does not reuse that ledger. Pi's public context result is authoritative even when it reports unknown values after compaction.

Model speed is intentionally narrower than Tokens and Cost:

```text
(provider output - reported reasoning, when available)
-------------------------------------------------------
active text + tool-call output-stream time
```

It excludes pre-output waiting, reasoning spans, tool execution, and gaps between model calls. `message_end` is provisional; `agent_settled` is final.

## Input-surface ownership

Pi exposes one custom-editor factory slot.

When pi-glance installs its editor it records the previous factory. On disable or shutdown it restores that factory only if Pi still reports pi-glance's own factory as current. If another extension has taken ownership, pi-glance leaves it untouched.

An enabled-to-enabled config save does not reinstall the editor or footer, preserving the live editor instance and Pi-owned editing state.

Pi does not currently expose equivalent footer ownership or a zero-height hidden footer. The empty fullscreen footer dock row is therefore an accepted Pi limitation.

## Theme ownership

Config uses a Glance-owned pair:

```ts
{ theme: { light: GlanceThemeName, dark: GlanceThemeName } }
```

Ambient selection is deliberately conservative:

```text
Pi theme.name === "light" -> theme.light
Pi theme.name === "dark"  -> theme.dark
otherwise                 -> theme.light
```

Both slots can select any of the 22 Glance palettes. `/glance` does not manage Pi themes. Pi's public terminal capability is authoritative for color depth: truecolor output is used when available, otherwise palette RGB values are mapped to ANSI 256 colors without changing ambient-tone selection.

## Config invariants

- Current on-disk schema version: `8`.
- Legacy theme strings migrate to the same palette in both slots.
- Legacy Tokens Cache values migrate as `auto -> rate` and `show -> read-write`.
- Adaptive width is always on; legacy `display.adaptive` is discarded.
- Missing config is a writable new-install state.
- Invalid, unreadable, or newer-version config is diagnosed and treated as read-only.
- Saves write a unique temporary file and atomically rename it over `config.json`.

## Compatibility and packaging

- Development baseline: Pi `0.84.4`.
- Node floor: `>=22.19.0`.
- Pi packages are wildcard peer dependencies supplied by Pi and are not bundled.
- Production source is shipped directly as TypeScript.
- CI validates Node 22.19 and current Node 24.
- npm publication is performed manually by the project owner; automation and agents must not run `npm publish` or request credentials.

## Accepted decisions

See [`docs/adr/`](docs/adr/):

1. Input surface, not a second TUI.
2. Public Pi interfaces and ownership-safe integration.
3. Session facts, context truth, and settled Model speed.
4. Glance-owned light/dark palette pairs.
5. A deep refresh session with change-driven rendering.
