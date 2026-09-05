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
- **Config store** — a path-bound file adapter created at extension construction; it owns load diagnostics and atomic replacement, not display rules.
- **Segment tone** — `normal`, `warning`, or `error`, supplied alongside display content by a segment feature. It is distinct from the light/dark ambient tone.

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
index.ts                              stable Pi package entry and path selection
  -> src/config/store.ts              diagnosed reads and atomic writes
       -> src/config/model.ts         defaults, validation, migration, transforms
  -> src/runtime/runtime.ts           Pi wiring and input-surface ownership
       -> refresh-session.ts          lifecycle semantics and render decisions
            -> snapshot.ts            public Pi facts -> Glance inputs
            -> state.ts               visible-state mutations
            -> throughput-run-tracker.ts
       -> git.ts                      asynchronous cached Git process adapter
            -> git-snapshot.ts        snapshot construction and status parsing

src/surface/editor.ts
  -> frame.ts                         shared live/preview input-surface frame
       -> layout.ts                   width-safe geometry
       -> status-line.ts              adaptive fitting and semantic styling
            -> src/segments/registry.ts
                 -> git/cost/throughput/context/tokens/model.ts

/glance -> src/settings/pane.ts        Pi input and rendering adapter
             -> model.ts              intents, navigation state, preview view model
             -> catalog.ts            setting rows and theme browser catalog
             -> src/surface/renderer.ts -> frame.ts

src/theme/                            curated catalog, palette, style selection
src/types.ts                          shared Glance fact/config/display vocabulary
tests/                                behavior and architecture tests
tests/fixtures/                       independent expected theme data
scripts/                              developer utilities, not test implementations
```

`src/runtime/runtime.ts` must remain orchestration-focused. It must not absorb state mutation, session usage accounting, or frame composition.

Configuration rules, the settings model/catalog, Git snapshot parsing, and Model speed calculation/tracking are transitively free of filesystem/process work and Pi runtime imports. State and render paths do not acquire Glance-owned IO through local helper imports; Pi's external editor/TUI implementation remains host-owned.

`RuntimeRefreshSession` exposes semantic lifecycle methods such as `modelSelect`, `sessionTree`, `messageEnd`, and `agentSettled`. Snapshot plans and ordering are implementation details, not caller-visible interfaces.

Segment features own display content, semantic tone, and any feature-specific icon spacing. The generic renderer maps tone to palette styles without parsing formatted text or branching on feature IDs. Context warning/error thresholds use Pi's unrounded public percentage (`>=75` / `>=90`) in every display mode; unknown percentage stays normal rather than being inferred from token counts.

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
- Pane state is a discriminated union: theme browsing always carries its slot and restore state; normal settings cannot retain browser state. Rendering receives preview config, density, and edited slot through the view model, not raw navigation state.

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
- `index.ts` resolves the Pi agent directory when the extension factory runs and creates a config store for the resulting path. Merely importing configuration rules or the extension never reads/binds a config file.
- Config store tests use independent real temporary files, without resetting module caches or mutating environment variables.

## Compatibility and packaging

- Development baseline: Pi `0.84.4`.
- Node floor: `>=22.19.0`.
- Pi packages are wildcard peer dependencies supplied by Pi and are not bundled.
- Production source is shipped directly as TypeScript: root `index.ts` plus `src/**/*.ts`. Tests and fixtures are not shipped.
- CI and GitHub Release reuse one validation workflow on Node 22.19 and current Node 24. Branch CI does not run on tags; tagged releases retain their own validation gate.
- Tests use production interfaces and named behavior scenarios. A shared recursive import graph enforces local acyclicity and transitive dependency rules; independent snapshots protect curated visuals without locking source expressions.
- A packaging test checks the exact npm dry-run file tree against all production source files. Directory changes must not leave missing imports in the published package.
- npm publication is performed manually by the project owner; automation and agents must not run `npm publish` or request credentials.

## Accepted decisions

See [`docs/adr/`](docs/adr/):

1. Input surface, not a second TUI.
2. Public Pi interfaces and ownership-safe integration.
3. Session facts, context truth, and settled Model speed.
4. Glance-owned light/dark palette pairs.
5. A deep refresh session with change-driven rendering.
6. Localize configuration IO, display semantics, and state invariants.
