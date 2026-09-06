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

The beam crosses only the left region, in a 2–3.6 second cycle with a broad bold core and feathered edges. `src/theme/working-colors.ts` assigns one chromatic accent per palette; title and connector share that peak and intensity. Tests check Oklab color separation from both original foregrounds and at least 4.5:1 peak contrast on reference backgrounds in RGB and ANSI256. Reference backgrounds include black/white and `#282828`/`#f5f5f5`; no terminal-background query is made, so arbitrary terminal backgrounds are not guaranteed. The radius is bounded to 9–28 columns, with a wider flat core and smooth edges. Unlit text retains its original color. All right-hand status bytes, their trailing border, corners, scroll labels, the editor body, bottom edge, and Pi's Bash border callback stay unchanged.

`src/runtime/working-sweep.ts` owns the 30 FPS display clock and ordinary Working-row visibility. It runs only while Glance owns the editor, pauses for blocking UI, and stops at `agent_settled` when Pi is idle. Disabling the effect or Glance restores the native Working row. Re-enabling during a prompt waits for `ui_prompt_end` before animating. Retry and compaction notices remain Pi-owned. Pi has no getter for Working-row visibility, so Glance cannot restore a different extension's prior hidden-row preference.

The live editor retains its original status-string cache; animation does not recolor or collect status facts. `src/surface/top-edge-sweep.ts` shades only glyphs near the beam and emits unlit text in bulk. Unicode measurements have a bounded cache (32 strings, at most 1,024 UTF-16 units each); palette/gradient resources are reused by theme and color mode. The width stops before the status area. Animation does not share the Model speed clock, invalidate its data, or replay missed frames after a blocked event loop.

## Status density

`src/surface/status-line.ts` selects one shared density from the available status columns: full at 96 or more, compact at 64–95, minimal below 64. These are status-area columns after the workspace title, not terminal-width or monitor fractions. The settings pane can explicitly preview the same modes. Every feature receives that density; individual segments do not invent independent breakpoints.

The shared meaning is **details → primary facts → identity/essential state**, not a requirement to shorten every value three times. With default settings:

| Segment | Full | Compact | Minimal |
| --- | --- | --- | --- |
| Git | Branch, dirty/conflict marker, upstream counts | Branch and dirty/conflict marker | Same as compact |
| Cost | Compact USD | Same | Same |
| Model speed | `43 tok/s` | `43/s` | Same as compact |
| Context | Percentage and token capacity | Percentage | Same as compact |
| Tokens | Input/output and cache rate | Cache rate | Same as compact |
| Model | Provider/name and Thinking | Complete model name | Model name without a matching Provider prefix |

Explicit content choices still apply, such as Context tokens-only, Git SHA always, and Model labels set to always. Unknown/zero values, conflicts and Context warning colors retain their existing meaning. `tests/surface/test-status-density.ts` checks the joint six-segment matrix, shared breakpoints, actual half-screen frames and these exceptions.

## Model fitting

Automatic model labels keep four semantic alternatives:

```text
TEAM/team-gpt-6-astra xhigh
team-gpt-6-astra xhigh
team-gpt-6-astra
gpt-6-astra
```

The shared densities start at alternatives 1, 3 and 4 respectively. Alternative 2 is an intermediate overflow fallback within full density, not the default compact label. If the label still does not fit, try the remaining shorter alternatives in order. The final tier removes exactly one leading `<provider>-` prefix, matched case-insensitively against the current provider. Other prefixes, occurrences inside the name, an empty remainder, and configured custom aliases are left intact. Explicit `always` labels remain attached at every tier. There are no fixed per-density name-length caps.

`src/segments/model.ts` supplies these alternatives as data; `src/segments/render.ts` measures columns and truncates at grapheme boundaries. The status-line fitter tries them before removing the segment. It keeps configured priority: earlier facts are not shortened or dropped to preserve later ones. Only after the shortest applicable tier fails to fit does the renderer use grapheme-safe middle ellipsis. An ellipsized name needs at least seven available columns; otherwise the trailing segment is removed. The last remaining segment retains the emergency width-safe clipping behavior at tiny widths. Growing the terminal re-renders from the full state, not the previously shortened string. The live status cache keeps this work off animation frames.

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
- New-install and settings-reset defaults use Nerd Font icons, smart workspace paths, one top-margin row, and all six segments enabled. Other defaults include a three-row editor, Working animation on, light/dark palette slots, input/output Tokens with cache rate, and automatic provider/thinking labels. Defaults fill missing or invalid values; valid saved choices are preserved. Changing defaults does not change the schema version.
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

`package.json`'s `files` list controls the npm package contents. Only runtime TypeScript, READMEs, the manifest and license are shipped; tests, scripts, assets and local state stay out of the tarball. The package-content test checks this exact file list.

`docs/` and `.pi/` are reserved for local notes and Pi settings and are ignored by Git. `.github/release-notes/` keeps the current release notes; previous versions remain in Git history and GitHub Releases. `npm run clean` removes only `.tmp-test/`, leaving dependencies, local settings and release tarballs intact. `npm run build:dev` cleans before compiling.

`npm ci`, `npm run check` and `npm test` install dependencies, typecheck, and run the full test suite. Use `npm run pack:dry` to inspect the package or `npm pack` to create a release tarball.

Developer utilities:
- `npm run debug:git -- /path/to/repo` prints a Git snapshot.
- `npm run preview:working` previews Working animation and status density without model calls or configuration writes. Use Left/Right for palettes, `C` for color depth, and resize the terminal to check fitting.
