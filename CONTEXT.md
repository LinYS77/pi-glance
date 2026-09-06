# Implementation notes

## Purpose

pi-glance adds a rounded frame, workspace title, and status line to Pi's editor. Display settings are available through `/glance`.

Pi still handles text editing and terminal layout. Glance does not provide a separate TUI or manage Pi themes.

## Data and terminology

- **Input surface** — the Pi-owned editor area plus the Glance frame and inline status facts around it.
- **Glance state** — the in-memory, render-ready facts consumed by the input surface.
- **Billed-session facts** — usage and cost accumulated across every persisted Pi session entry that carries provider usage.
- **Context truth** — Pi's current public `ctx.getContextUsage()` result. `null` means unknown and is not inferred from another source.
- **Model speed** — provider-reported non-reasoning output divided by measured active text/tool-call output-stream time for the settled logical run.
- **Ambient tone** — `light`, `dark`, or `unknown`, derived only from the exact public Pi theme name.
- **Theme slot** — the configured Glance palette selected for a light or dark ambient tone.
- **Refresh session** — `RuntimeRefreshSession` handles lifecycle events, usage deduplication, Model speed tracking, Git refresh scheduling, and render decisions.
- **Config store** — reads a configuration file and replaces it atomically on save. Its path is supplied when the extension is created.
- **Segment tone** — `normal`, `warning`, or `error`, supplied alongside display content by a segment feature. It is distinct from the light/dark ambient tone.

## Responsibilities

pi-glance handles:

- the Glance editor frame and status line;
- always-on adaptive segment fitting;
- the `/glance` settings pane, bounded theme browser, and transient density preview;
- Pi selection keybindings and category → setting → value navigation;
- six display features: Git, Cost, Model speed, Context, Tokens, and Model;
- its 22 palettes;
- asynchronous cached Git status collection;
- the global config at `~/.pi/agent/pi-glance/config.json`;
- migration and validation of known config fields;
- atomic config replacement and load-error reporting.

Pi handles:

- editor text editing, history, autocomplete, cursor behavior, selection, IME, and app keybindings;
- terminal/fullscreen layout and footer dock allocation;
- the current model, thinking level, model scope, session lifecycle, and context calculation;
- extension loading order and the single custom-editor slot;
- Pi UI themes and theme switching.

## Scope

The following are outside Glance's scope:

- Pi core/TUI patches or private deep imports;
- a standalone/fullscreen Glance TUI;
- fixed editor regions implemented outside Pi's public layout APIs;
- generic duck-typed wrapping of arbitrary third-party editors;
- Pi theme enumeration, installation, switching, or reimplementation of theme token-color rendering;
- terminal background queries, ANSI inspection, or fuzzy light/dark inference;
- render-time filesystem, process, or network work;
- Model speed token estimation from text/content length;
- Model speed timers, tickers, or notifications;
- production `sessionManager.getBranch()` reads.

## Runtime architecture

```text
index.ts                              stable Pi package entry and path selection
  -> src/config/store.ts              config reads and atomic writes
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

src/theme/                            palette data and style selection
src/types.ts                          shared state, config, and display types
tests/{config,runtime,surface,settings,segments,theme}/
                                      behavior tests grouped like production
tests/architecture/                   import and dependency checks
tests/packaging/                      npm contents and public documentation
tests/support/                        shared test adapters and fixture builders
tests/fixtures/                       independent expected theme data
scripts/                              developer utilities, not test implementations
```

`src/runtime/runtime.ts` connects Pi events to the refresh session and manages editor/footer installation. State updates belong in `state.ts`, session accounting in `refresh-session.ts`, and frame rendering in `src/surface/`.

Configuration rules, settings state and catalog, Git status parsing, and Model speed tracking have no file/process IO or Pi runtime imports, including through local dependencies. File access stays in `src/config/store.ts`; Git execution stays in `src/runtime/git.ts`.

`RuntimeRefreshSession` exposes lifecycle methods such as `modelSelect`, `sessionTree`, `messageEnd`, and `agentSettled`. It handles snapshot selection and update ordering internally.

Each segment returns display content, a color level, and any custom icon spacing. The renderer applies palette colors without parsing display text. Context uses Pi's unrounded percentage for warning (`>=75`) and error (`>=90`) colors in every display mode. An unknown percentage keeps the normal color, even when token counts are available.

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
- `GlanceConfigPane` translates keys into model intents rather than calling `SelectList.handleInput()`, so it uses the keybindings supplied by Pi.
- Preview density cycles through Auto, Full, Compact, and Minimal without entering `GlanceConfig` or dirty comparison.
- Pane state is a discriminated union: theme browsing always carries its slot and restore state; normal settings cannot retain browser state. Rendering receives preview config, density, and edited slot through the view model, not raw navigation state.

## Usage calculations

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

## Editor integration

Pi exposes one custom-editor factory slot.

When pi-glance installs its editor it records the previous factory. On disable or shutdown it restores that factory only if Pi still reports pi-glance's own factory as current. If another extension has taken ownership, pi-glance leaves it untouched.

An enabled-to-enabled config save does not reinstall the editor or footer, preserving the live editor instance and Pi-owned editing state.

Pi has no public footer getter or zero-height hidden footer. An empty footer row therefore remains in fullscreen mode.

## Working animation

`editor.workingSweep` defaults to `true`, including when older configs omit the field. `/glance` → General → Working animation controls it. Saving changes takes effect on the current editor without replacing its factory or clearing input. Cancelling the pane, a failed save, or a read-only config leaves the active setting unchanged. The settings pane animates its preview only while this row is focused and enabled, and disposes the preview clock on close. `npm run preview:working` remains a standalone development preview without model calls or installation changes.

The beam crosses only the left region, in a 2–3.6 second cycle with a broad bold core and feathered edges. Title and connector use the same intensity. The palette adapter chooses a contrasting neutral peak using the theme's declared light/dark tone and the actual RGB/ANSI256 foreground. Contrast tests cover all 22 themes, including already-dark/light high-contrast colors. Black/white reference backgrounds are used for these tests; no terminal-background query is made. Unlit text retains its original color. All right-hand status bytes, their trailing border, corners, scroll labels, the editor body, bottom edge, and Pi's Bash border callback stay unchanged.

`src/runtime/working-sweep.ts` owns the 30 FPS display clock and ordinary Working-row visibility. It runs only while Glance owns the editor, pauses for blocking UI, and stops at `agent_settled` when Pi is idle. Disabling the effect or Glance restores the native Working row. Re-enabling during a prompt waits for `ui_prompt_end` before animating. Retry and compaction notices remain Pi-owned. Pi has no getter for Working-row visibility, so Glance cannot restore a different extension's prior hidden-row preference.

The live editor retains its original status-string cache; animation does not recolor or collect status facts. `src/surface/top-edge-sweep.ts` shades only glyphs near the beam and emits unlit text in bulk. Unicode measurements have a bounded cache (32 strings, at most 1,024 UTF-16 units each); palette/gradient resources are reused by theme and color mode. The width stops before the status area. Animation does not share the Model speed clock, invalidate its data, or replay missed frames after a blocked event loop.

## Theme selection

Config stores two Glance palettes:

```ts
{ theme: { light: GlanceThemeName, dark: GlanceThemeName } }
```

Palette selection uses the exact Pi theme name:

```text
Pi theme.name === "light" -> theme.light
Pi theme.name === "dark"  -> theme.dark
otherwise                 -> theme.light
```

Both slots can select any of the 22 palettes. `/glance` does not change Pi themes. Colors use Pi's reported terminal capability: RGB when truecolor is available, ANSI 256 otherwise.

For Bash input (`getText().trimStart().startsWith("!")`), the live frame uses the editor's public `borderColor` callback. Pi updates this callback when input mode or theme changes. Normal input, title, and status keep Glance colors; unfocused borders remain dimmed. Changing only the border does not invalidate the status cache.

At extremely narrow widths, the inherited editor is given enough room for a two-column character plus padding and cursor space. Glance then clips the result to the frame width. This avoids Pi 0.84's one-column wrapping recursion without changing the text.

## Configuration

- Current on-disk schema version: `9`.
- Missing or invalid `editor.workingSweep` defaults to `true`; explicit `false` is preserved. Migration is in memory and writes only on an explicit save.
- Legacy theme strings migrate to the same palette in both slots.
- Legacy Tokens Cache values migrate as `auto -> rate` and `show -> read-write`.
- Adaptive width is always on; legacy `display.adaptive` is discarded.
- Missing config is a writable new-install state.
- Invalid, unreadable, or newer-version config is diagnosed and treated as read-only.
- Saves write a unique temporary file and atomically rename it over `config.json`.
- `index.ts` resolves the Pi agent directory and creates the config store when the extension starts. Importing the modules does not read a config file.
- File-store tests use separate temporary directories.

## Compatibility and packaging

- Development baseline: Pi `0.84.4`.
- Node floor: `>=22.19.0`.
- Pi packages are wildcard peer dependencies supplied by Pi and are not bundled.
- Production source is shipped directly as TypeScript: root `index.ts` plus `src/**/*.ts`. Tests and fixtures are not shipped.
- CI and GitHub Release share the Node 22.19/24 test workflow. Branch CI does not run on tags.
- Tests import the project interfaces directly. Import-graph checks detect cycles and forbidden dependencies; separate fixtures verify palette data.
- The package test compares `npm pack --dry-run` output with the full production file list.

## Repository files

`docs/` contains local notes and is ignored by Git. Published release notes are available in GitHub Releases; the tag workflow reads the current notes from `.github/release-notes/`. Test build output and npm tarballs are also ignored.
