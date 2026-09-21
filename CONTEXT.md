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
- Pi selection keybindings, four settings sections and direct row editing;
- six built-in facts (Git, Cost, Model speed, Context, Tokens, Model) and one external Extensions group;
- its 22 palettes;
- asynchronous cached Git summaries and noninteractive upstream fetch;
- a single session-local prompt stash with configurable shortcut;
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
          src/config/settings.ts      shared setting descriptors and choices
  -> src/input/store.ts               private, atomic per-session draft files
  -> src/runtime/runtime.ts           Pi wiring and input-surface ownership
       -> refresh-session.ts          lifecycle semantics and render decisions
            -> snapshot.ts            public Pi facts -> Glance inputs
            -> state.ts               visible-state mutations
            -> throughput-run-tracker.ts
       -> git.ts                      local polling and summary collection
            -> git-snapshot.ts        pure status and numstat parsing
            -> git-command.ts         bounded, cancellable Git process IO
            -> git-remote.ts          upstream fetch interval and retry policy
       -> src/input/stash.ts          single-slot exchange, save before clearing

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

Configuration rules, setting descriptors, settings state and catalog, Git status parsing, and Model speed tracking have no file/process IO or Pi runtime imports, including through local dependencies. File access stays in `src/config/store.ts` and `src/input/store.ts`; Git process IO stays in `src/runtime/git-command.ts`.

`RuntimeRefreshSession` exposes lifecycle methods such as `modelSelect`, `sessionTree`, `messageEnd`, and `agentSettled`. It handles snapshot selection and update ordering internally.

Each built-in segment returns display content, a color level, and any custom icon spacing. Extensions is an ordered status item, not a synthetic built-in fact: it has no collector, palette entry or Glance icon. The renderer applies palette colors without parsing display text. Context uses Pi's unrounded percentage for warning (`>=75`) and error (`>=90`) colors in every display mode. An unknown percentage keeps the normal color, even when token counts are available.

## Refresh and render rules

- `session_start` and structural `session_tree` may reconcile full persisted entries.
- Ordinary lifecycle events use public lifecycle snapshots and event deltas; they do not rescan all entries.
- Compaction usage comes from `SessionCompactEvent.compactionEntry`.
- Pi 0.86 standalone `usage` entries (including cache warming and unknown kinds) belong to the same billed-session ledger. Initial/reliable snapshots count them alongside messages and summaries. Before a live editor or settings preview reads its state, an in-memory cursor checks the public `getLeafId()` and walks only unseen `getEntry(id).parentId` links, applying standalone usage once. Pi's own post-warming redraw drives idle updates; unchanged frames are O(1), with no timer, full-history rescan, fabricated event, or use of pre-request cost estimates. This does not touch Context or Model speed. Reliable snapshots reseed the cursor, and retired UI callbacks cannot read a replaced session.
- Assistant/tool-result usage comes from `message_end` deltas and is deduplicated by stable public IDs when available.
- Context always comes from `ctx.getContextUsage()`.
- Git scheduling is independent from render decisions.
- Ordinary lifecycle events request a render only when visible Glance state changes.
- Blocking `ui_prompt_start` / `ui_prompt_end` spans pause Model speed timing without requesting a render.
- Config save always requests a render because display configuration can change without changing session facts.
- Git snapshots request a render only when visible Git facts change; timestamp-only updates remain silent.

## `/glance` interaction rules

- The pane has four sections: **Appearance**, **Status line**, **Activity**, and **Input**. Tab/Shift+Tab cycles sections while in a list. Sections remember their last list/detail page, and each segment remembers its selected detail row. There is no separate value-focus column.
- Up/Down selects a row; lists and paged moves stop at their ends. Left/Right means previous/next for choices and palettes, slower/faster for speed, and Off/On for booleans and status items. Directional adjustments do not wrap or toggle repeatedly. Enter toggles a boolean or opens its editor/details; Space toggles boolean/status rows. Pi selection bindings are used for input and displayed in the hints.
- Appearance owns the Glance toggle, light/dark palettes, icons and workspace label. Input owns editor height, top spacing, Prompt stash and its shortcut. Palette labels explicitly describe Glance colors, not Pi theme switching.
- The Status line overview owns visibility and ordering. Space toggles a segment, Left/Right sets Off/On, J/K reorders it, and Enter opens details. Extensions uses the same overview interaction, with a read-only live status list rather than editable settings. Detail pages do not duplicate the visibility toggle or show read-only facts as editable rows. Disabled segments remain configurable and are marked Off in the detail title.
- Activity (stable internal section id `working`) owns six rows: Display mode, Effect area, Sweep speed, Effect color, Compaction / summary speed and Retry blink rate. Text is the default; all five effect parameters remain editable but are marked inactive until Sweep is selected. Nine theme-matched effect colors use the existing choice picker. Base speed is an integer from 10–120 cols/s (default 47, step 1); summary multiplier is 0.25–2.00× (default 0.50, step 0.05); retry blink rate is 0.25–2.00 Hz (default 0.50, step 0.25). Decimal fields accept up to two decimal places, including values not on the arrow-step grid. Enter opens Pi's `Input`; the first printable/Kitty key replaces the original value, and arrows then move the cursor. Valid input previews immediately; incomplete/invalid text preserves the last valid preview and produces a field-specific error only on confirmation. Paste payloads and letter shortcuts remain input.
- Every field editor uses **Enter Confirm / Esc Cancel**: confirm keeps the value in the draft and returns to the same row; cancel restores the pre-edit value without losing earlier draft changes. Choices/palettes preview with arrow keys and keep their original option list stable. A saved custom value remains explicitly selectable rather than being replaced on open.
- Only lists expose S to save and close, R to reset, and Tab to change sections. Field editors must be confirmed or cancelled first, so browsing a palette cannot accidentally save the entire draft. The view model supplies both navigation hints and actions; the TUI adapter resolves Pi's actual keybindings and does not invent page-specific actions. No file is written by the pane itself.
- Reset and leaving the root with unsaved changes require confirmation, initially selecting **Keep editing**. Ctrl-C remains an unconditional cancel. Reset changes the draft only until saved and retains the current section/selected setting.
- `/glance` uses Pi's public bottom-anchored, full-width overlay rather than replacing the editor with a taller component. The real editor remains mounted, so opening and closing settings does not expand/shrink Pi's conversation flow or reset the prompt cursor. Both supported TUI modes allow Glance's empty footer to occupy zero rows, so the overlay has no bottom inset. No terminal coordinates, forced redraws or global clear-on-shrink changes are used.
- Controls remain one centered list, at most 100 columns wide. A bounded viewport reserves up to eight entries plus a scroll indicator, with stable description and shortcut slots. Short detail pages, pickers, confirmation and Glance Off keep their space rather than moving the preview; the pane does not fill a tall terminal. Lists adapt to terminal height and keep the selection visible; when four list rows and the preview cannot fit, the preview is omitted on every page and its clock pauses.
- The preview sits below the controls and uses the full input width, so Auto fits the same status facts as the live editor. It remains bottom-anchored while browsing; changing editor height or spacing still changes the displayed frame. In a short regular-mode conversation the native editor may be above the screen bottom: the overlay does not move that editor just to align it with the preview. Pi still owns background layout and focus restoration.
- The palette catalog remains complete, with a bounded Pi `SelectList` viewport. Pi's `Input` supplies editing and cursor markers; Glance propagates `Focusable` state to it. The custom UI adapter disposes its clock even on external close or rejection.
- D cycles Auto, Full, Compact and Minimal preview layouts in Status line. P cycles Working, Compacting, Summarizing, Retrying and Idle with draft examples in Activity lists. Selecting a different Activity row chooses its relevant default scene: multiplier → compaction, frequency → retry, otherwise Working. Adjustments within the same row do not override the manual scene. These are transient presentation choices, excluded from dirty comparison and saved config. Example labels include the display mode and effective rate; Text examples never start a Glance effect clock.
- Navigation state distinguishes the list, choice picker, palette picker, number input, shortcut recorder and confirmation. Pickers carry their parent row and restore config; rendering uses the view model, not an additional navigation state.

## Usage calculations

Tokens and Cost use the whole persisted billed-session ledger:

- assistant messages;
- usage-bearing tool results;
- standalone `usage` entries, regardless of `kind`;
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

An enabled-to-enabled config save does not reinstall the editor or footer, preserving the live editor instance and Pi-owned editing state. Pi disposes the Glance footer when another extension replaces it; that notification detaches the status source and releases ownership. Disable and shutdown only restore the built-in footer while Glance still owns the slot. Disabled startup leaves both editor and footer slots untouched.

Pi has no public footer getter. The supported Pi 0.86.1+ layout permits Glance's footer to occupy zero rows in both modes.

## Extension statuses

`Extensions` is enabled by default in Status line, between Tokens and Model. It can be toggled and reordered like other status items. Enter opens a read-only detail view of publisher keys and current text, even while the group is Off or too narrow to appear in the preview. An empty view distinguishes an unattached footer data source from an attached source with no visible statuses. Up/Down and page keys scroll; switching sections remembers the position. Live text is never presented as an editable setting or saved to config. Empty and ANSI-only values leave no text, icon, separator or additional footer row. Old configs gain the item immediately before Model, preserving the existing items' order and enabled flags; changes are only written on Save.

The runtime captures only the public `getExtensionStatuses` capability from the existing `setFooter` factory and passes a lazy source to the editor and settings preview. The footer still returns `[]`; it does not transport values through its render method. Disposing that footer, disabling Glance, shutdown and generation changes detach the source. Pi owns the Map and triggers TUI rendering on `ctx.ui.setStatus()`. Glance neither polls nor intercepts publishers, and does not add an event bus protocol or put external UI text in `GlanceState` or the session ledger.

Rendering copies entries, sorts by key, normalizes CR/LF/Tab to spaces, trims with Pi's column-aware tools and displays values only. Glance supplies the base text and separator colors; publisher SGR styling and OSC 8 links remain intact, while cursor, screen and clipboard commands are stripped. Each value resets SGR and closes OSC 8 before the next item. Both preview and editor read the live source on render. The line cache compares copied normalized string values, including ANSI: same-Map, same-key, same-size changes do not require a state revision. Each line render normalizes once and uses that snapshot for both cache comparison and fitting. Whole-entry overflow fitting measures entries once rather than repeatedly joining every shorter prefix. The settings pane reads one provider Map per render for its preview and detail view.

External text receives only columns left after fitting the built-in facts, capped at one third of the status budget when built-ins are present. Four columns are the minimum useful external budget. Without built-ins it may use the whole budget. Overflow first preserves complete leading entries plus `…`; if the first alone is too long it is column-truncated. With no useful room the entire group disappears. Extension text never makes an otherwise-visible built-in label shorter or disappear. Widgets, dialogs, and arbitrary custom editors/footers are not converted into statuses; Pi's single-slot ownership limits still apply.

## Prompt stash

`alt+s` exchanges the main editor's text with one draft slot. An empty slot takes the prompt and clears the editor; an empty editor restores and clears the slot; two nonempty buffers swap. Neither operation submits input, changes Pi's queue, or interrupts a running model. Empty/empty is silent. The bottom border uses the same connector and padding as the workspace title: `╰─ draft · alt+s ─`. Nerd Font mode replaces `draft` with the inbox glyph ``; both use lowercase shortcut labels. The hint appears only while occupied and shortens at narrow widths. Text-mode activity exclusively replaces it at the same left-hand position; no stale hint is restored when activity ends. The native scroll cue is reserved on the right, with priority under width pressure. Sweep/blink mode leaves the draft hint visible and unchanged. Border labels share one layout rule rather than being passed through scroll-indicator formatting.

Glance uses the editor's public expanded-text getter so collapsed paste markers never replace their payload. Restored text uses Pi's normal setter, placing the cursor at the end and retaining native undo behavior. Shortcut changes are read from the active config without replacing the editor. Pi's effective bindings and existing extension handlers take precedence; paste payloads, unfocused editors and Kitty repeat events cannot trigger Stash.

`/glance` → Input records one key combination. Enter confirms, Esc cancels, and Ctrl+C discards the pane. Conflicting Pi actions are named; plain text and pasted key strings cannot be bound. Only the outer Save commits the shortcut.

Drafts live at `<agent-dir>/pi-glance/drafts/<session-id>.json`, separate from configuration and Pi's conversation. New files are mode 0600 and are atomically replaced; restoring removes the file. A failed save leaves input and stash unchanged. A malformed/unreadable file is preserved and disables Stash for that runtime, with a warning. `/reload` and resuming the same session make the slot available again but do not auto-fill the editor. New/forked sessions have independent slots. `--no-session` uses memory only. File references are text; Glance does not copy referenced files or clipboard images. Drafts belonging to abandoned sessions remain until restored or explicitly removed by the user.

## Git

`git.changes` is Hidden, Marker or Summary. Summary is the new-install default, and **all pre-v12 dirty preferences migrate to Summary**, including a previously hidden marker. The Git segment's enabled flag and its order remain unchanged. Once saved as v12, all three choices round-trip without further migration.

Summary collects a NUL-delimited porcelain status with explicit untracked-file enumeration. Each status record describes one current path; the extra rename source field is skipped. This counts a file once even when both index and working tree differ. Only aggregate numbers enter `GlanceState`, not file lists. Tracked line counts compare the working tree with HEAD (or the empty tree before the first commit), rather than adding staged and unstaged diffs. Untracked file contents are not read for line counts. Binary/incomplete numstat results omit the line totals. External diff and textconv drivers are disabled.

Full density offers file and line counts plus upstream commits; compact offers files; minimal restores the dirty marker. Counts replace the ordinary dirty marker, but never a conflict marker. Zero line counts stay hidden. Optional Git summary detail yields before another segment is shortened or dropped, down to the equivalent Marker display. This exception does not change the configured priority of existing primary facts. Temporary collection failures retain the last known branch with `?` and hide potentially outdated upstream/line counts.

Local collection has one in-flight request, bounded debounce for tool bursts (an existing deadline is never postponed), a total timeout, an output limit, cancellation on disposal and a polling fallback. Configured Marker/Hidden modes skip diff statistics. Git IO never runs during rendering or animation.

`git.autoFetch` defaults on. It requires TUI mode, an enabled Git segment, a writable config, a trusted project, and no `PI_OFFLINE=1`. Invalid or future configs never opt into network access through fallback defaults. The actual branch upstream supplies the remote and refspec; there is no fixed `origin/main` comparison. On first collection and then every five minutes, a separate bounded task fetches only that upstream tracking ref. It never merges, checks out, writes FETCH_HEAD, fetches tags, recurses submodules or starts automatic maintenance. Local status collection does not wait for the network. Successful fetch schedules a local refresh; failure retries after 1, 2, 4, 8, 16 and then 30 minutes without notifications. Counts still describe local tracking refs, not a continuously live remote.

Git children use pipes and a separate process session on POSIX; Git/SSH/credential-manager interactive prompts are disabled for fetch. Network requests time out after ten seconds per command and are cancelled when Git or auto-fetch is disabled or the runtime shuts down. Auto fetch can be disabled in Status line → Git. It uses existing Git authentication; Glance does not provide login UI.

## Activity presentation

`editor.activityMode` selects **Text** (default) or **Sweep**. The modes are mutually exclusive. `GlanceEditor` opts into Pi's `embedWorkingStatus` and receives the public `setWorkingStatusIndicator` callback for Working, compaction, branch summary and retry. It does not put the indicator in the parent editor's top border and does not call global `setWorkingVisible`. Pi owns and disposes the native indicator and countdown; Glance owns only its presentation and effect clock. Disabled Glance restores the previous editor normally.

Text renders the current native `renderInBorder(width)` content in the bottom-left label, stripping terminal controls and applying Glance title/warning colors. It exclusively replaces the draft hint and reads live native text on every render. Scroll information has a reserved right-hand budget. The same frame height, top-line facts, input, cursor and keybindings are preserved. Pi's own redraws drive spinner/countdown updates; no Glance effect timer runs in Text.

Sweep uses **Top edge** or **Full border** (`editor.workingSweep: top | perimeter`). Working moves at `workingSweepSpeed`, default 47 horizontal columns/s. Compaction and branch summary use that base multiplied by `summarySpeedMultiplier`, default 0.50×. Actual speed remains fractional and ranges from 2.5 to 240 cols/s, independently of the base setting's integer 10–120 constraint. Retry switches from motion to alternating normal/highlighted border lines at `retryBlinkHz`, default 0.50 Hz: one complete cycle every two seconds. `Effect area` governs both moving and blinking borders. Retry never flashes input, status facts, workspace text, draft labels or scroll text, and its frequency never changes Pi's retry policy. No native activity means no effects; cache warming does not invent an activity.

`src/runtime/activity-animation.ts` owns one `ActivityClock` per surface. Native phase, current configuration, focus, blocking UI and editor ownership determine whether it runs. It tracks travelled columns or complete blink cycles, preserves phase across rate changes/pauses, and never replays blocked time. Sweeps schedule at 30 FPS; blinking schedules only the next half-cycle boundary. Frame reads reconcile state without scheduling extra redraws. Saves refresh the current editor in place; late callbacks cannot revive disposed instances. Agent lifecycle events still feed accounting/Model speed but no longer start or stop border effects.

The settings preview shares the clock and frame renderer, using clearly labeled local examples rather than fake Pi events. It pauses when hidden and disposes on close, rejection or external completion. `npm run preview:working` exercises the same presentation without model calls or config writes.

Top-edge mode crosses the title and its connector; corners, right-hand status, scroll labels and other edges remain unchanged. Perimeter mode follows one clockwise closed path through the title, visible top border, corners, sides and bottom. It uses circular distance for a seamless wrap, including the feathered tail. One vertical row counts as two horizontal cells to approximate terminal-cell proportions. The loop uses the actual rendered body height, excluding top spacing and autocomplete. Status text and the draft hint, including their surrounding spaces, do not consume path distance: the beam bridges those gaps instead of disappearing behind metadata. Status bytes, draft labels and scroll labels remain unchanged in both modes.

`src/theme/working-colors.ts` keeps the original recommended accent for each palette and eight curated alternatives selected by `editor.workingSweepColor`: `theme` (default), `amber`, `rose`, `violet`, `blue`, `teal`, `mint`, `coral`, and `copper`. `/glance` → Activity → Effect color uses the shared choice picker. Colors follow the selected Glance palette, not a global RGB swatch: light palettes use deeper accents and dark palettes brighter ones. The same choice applies to both theme slots and both sweep modes. It changes only the beam/retry border highlight, never idle colors, status facts, warnings, input or Pi's Bash border callback. Saving replaces config in place without reinstalling the editor or changing sweep speed; cancelling or failed/read-only saves retain the active color.

Title and border share one peak and intensity. Tests check chromaticity, Oklab separation from the original title/border, and at least 4.5:1 peak contrast on reference backgrounds in RGB and ANSI256 for all 22 palettes and nine choices. Theme default retains its original, stronger separation threshold and exact output. Reference backgrounds include black/white and `#282828`/`#f5f5f5`; no terminal-background query is made, so arbitrary terminal backgrounds are not guaranteed. The radius is bounded to 9–28 columns, reduced further on tiny loops, with a broad bold core and smooth edges. Unlit text retains its original color. Both modes preserve input bytes, cursor markers, Pi's Bash border callback and unfocused dimming; one-column frames remain static in perimeter mode.

The live editor, settings preview and Working demo share `GlanceLineRenderer` in `src/surface/status-line.ts`. Each surface keeps one cached status string, invalidated by state identity/revision, config replacement, available width, provider count, palette/color mode, explicit density or external status contents. Config changes replace the config object; session facts increment `state.version`. Prompt content, cursor markers, frame layout and animation are never cached with the status line. Settings view models are rebuilt on input rather than every animation frame, and a hidden preview pauses its clock.

`src/surface/text.ts` owns plain and styled clipping. Plain text is measured once per grapheme; styled text that already fits bypasses truncation, preserving its bytes. Overflow still uses Pi's ANSI-aware truncation. Palette and gradient styles precompute their escape prefixes, including ANSI256 conversion. The style cache is bounded to 22 palettes × 2 color modes × 9 sweep colors.

Animation does not recolor or estimate status facts or initiate their IO. The state-read boundary checks already-persisted standalone usage independently of the animation clock. `src/surface/sweep.ts` shades only glyphs near the beam and emits unlit text in bulk. Unicode measurements have a bounded cache (32 strings, at most 1,024 UTF-16 units each); palette/gradient resources are reused by theme and color mode. `top-edge-sweep.ts` supplies the open-path profile; `perimeter-sweep.ts` maps frame coordinates to the closed path. Animation does not share the Model speed clock, invalidate its data, or replay missed frames after a blocked event loop.

## Status density

`src/surface/status-line.ts` selects one shared density from the available status columns: full at 96 or more, compact at 64–95, minimal below 64. These are status-area columns after the workspace title, not terminal-width or monitor fractions. The settings pane can explicitly preview the same modes. Every feature receives that density; individual segments do not invent independent breakpoints.

The shared meaning is **details → primary facts → identity/essential state**, not a requirement to shorten every value three times. With default settings:

| Segment | Full | Compact | Minimal |
| --- | --- | --- | --- |
| Git | Branch, change summary, upstream counts | Branch and changed-file count | Branch and dirty/conflict marker |
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

`src/segments/model.ts` supplies these alternatives as data; `src/segments/render.ts` measures columns and truncates at grapheme boundaries. Display order and removal priority are separate: **Model is always the last built-in item removed**, wherever the user places it. Other built-ins retain their relative configured priority. Git detail yields first, and the trailing fact's shorter labels are tried before removing the lowest-priority non-Model fact. Only after the shortest applicable model tier fails to fit does the renderer use grapheme-safe middle ellipsis. An ellipsized name needs at least seven available columns. The last remaining Model retains emergency width-safe clipping at tiny widths. Explicitly disabled Model stays disabled. Growing the terminal re-renders from full state, not shortened strings.

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

At extremely narrow widths, the inherited editor is given enough room for a two-column character plus padding and cursor space, then clipped through the frame. Pi 0.86.1 retains the one-column wide-grapheme recursion, so this guard and recognition of truncated scroll borders remain necessary. Thinking shortcuts now rely solely on Pi's `thinking_level_select` event; the old editor key callback and duplicate refresh plan have been removed.

## Configuration

- Current on-disk schema version: `15`.
- New-install and settings-reset defaults use Nerd Font icons, smart workspace paths, one top-margin row, and all seven status items enabled. Other defaults include a three-row editor, Text activity, full-border effect area, light/dark palette slots, input/output Tokens with cache rate, and automatic provider/thinking labels. Defaults fill missing or invalid values; the deliberate migrations are pre-v12 Git Summary and pre-v15 Text activity.
- Every pre-v15 config (including legacy top/perimeter/off and boolean modes) is forced to `activityMode: text` on load. Existing enabled state, speed, color and area are retained; old top/true maps to top, other areas to perimeter. New multiplier and blink rate default to 0.50. Normalized in-memory config already has schema 15, so choosing Sweep and saving persists that choice without applying migration again. Loading never rewrites the file; only explicit Save installs the new schema atomically. Reset defaults to Text.
- Missing or invalid `editor.workingSweepColor` defaults to `theme`, preserving the previous beam. Pre-v14 configs gain it in memory only; Save persists the chosen value. Git's pre-v12 migration threshold and saved extension ordering/visibility remain unchanged.
- Missing or invalid `editor.workingSweepSpeed` defaults to 47. Finite numbers are rounded and clamped to 10–120. Older config files gain the field in memory; loading does not rewrite them.
- Git timeout, debounce and polling delays are capped at Node's timer limit (2,147,483,647 ms), preventing large saved values from turning into one-millisecond timers.
- Legacy theme strings migrate to the same palette in both slots.
- Legacy Tokens Cache values migrate as `auto -> rate` and `show -> read-write`.
- Adaptive width is always on; legacy `display.adaptive` is discarded.
- Missing config is a writable new-install state.
- Invalid, unreadable, or newer-version config is diagnosed and treated as read-only.
- Saves write a unique temporary file and atomically rename it over `config.json`.
- `index.ts` resolves the Pi agent directory and creates the config store when the extension starts. Importing the modules does not read a config file.
- File-store tests use separate temporary directories.

## Compatibility and packaging

- Minimum supported Pi and pinned development SDK: `0.86.1`, for the unified native activity indicator and zero-height footer behavior.
- Node floor: `>=22.19.0`.
- Pi packages are `>=0.86.1` peer dependencies supplied by Pi and are not bundled.
- Production source is shipped directly as TypeScript: root `index.ts` plus `src/**/*.ts`. Tests and fixtures are not shipped.
- CI and GitHub Release share the Node 22.19/24 test workflow. Branch CI does not run on tags.
- Tests import the project interfaces directly. Import-graph checks detect cycles and forbidden dependencies; separate fixtures verify palette data.
- Display tests separate config upgrades, the shared save transaction, footer lifecycle, fitting and settings interactions. Live/preview parity compares the real entry points, not a copy of the renderer inside test helpers. Color-data checks cover all palette/color/depth combinations; UI tests use representative choices and scroll boundaries instead of repeating the same save matrix for every preference.
- The package test compares `npm pack --dry-run` output with the full production file list.

## Repository files

`package.json`'s `files` list controls the npm package contents. Only runtime TypeScript, READMEs, the manifest and license are shipped; tests, scripts, assets and local state stay out of the tarball. The package-content test checks this exact file list.

`docs/` and `.pi/` are reserved for local notes and Pi settings and are ignored by Git. `.github/release-notes/` keeps the current release notes; previous versions remain in Git history and GitHub Releases. `npm run clean` removes only `.tmp-test/`, leaving dependencies, local settings and release tarballs intact. `npm run build:dev` cleans before compiling.

`npm ci`, `npm run check` and `npm test` install dependencies, typecheck, and run the full test suite. `npm run test:pane` covers the settings suite, including interaction, preview and save behavior; `npm run test:config` covers validation, migration and file storage. Use `npm run pack:dry` to inspect the package or `npm pack` to create a release tarball. The packaging tests also check that the manifest, lockfile and current release notes use the same version.

Developer utilities:
- `npm run bench:render` measures live editor and settings render time in RGB/ANSI256, both sweep modes, and 80/160-column terminals. It uses a fixed clock and example data, with no terminal or config writes. Compare runs on the same Node version and machine; timings are not CI pass/fail thresholds.
- `scripts/demo-extension-statuses.ts` is an opt-in test publisher, not a shipped extension. It emits clearly labelled DEMO quotas through `setStatus()`; `/glance-demo normal|low|long|clear` changes or clears only its own keys. It does not read credentials, make network calls, run timers or alter subscriptions. Try it with `pi -e ./scripts/demo-extension-statuses.ts`; it is not auto-loaded by the project.
- `npm run debug:git -- /path/to/repo` prints a Git snapshot.
- `npm run preview:input` exercises the real editor, Stash and settings with sample Git facts. F2 opens settings, Enter clears the prompt and Ctrl+C closes. No model, network, config or draft-file writes occur.
- `npm run preview:settings` opens the new settings pane with example data. Save/close exits the preview without writing configuration. Use `-- --light` or `-- --256` to check color modes.
- `npm run preview:working` previews Activity and status density without model calls or configuration writes. Use `D` for Text/Sweep, `P` for native activity examples, `M` for effect area, `A` for effect color, Left/Right for palettes, `C` for color depth, and resize the terminal to check fitting.
