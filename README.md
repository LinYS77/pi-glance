<div align="center">

# ◌ pi-glance

**A calm input surface for [pi](https://github.com/badlogic/pi-mono)**

Replace the default prompt with a rounded multiline editor
and an inline glance at model, context, tokens, cost, and Git.

[![npm](https://img.shields.io/npm/v/pi-glance?style=flat-square&color=blue)](https://www.npmjs.com/package/pi-glance)
[![license](https://img.shields.io/badge/license-MIT-64748b?style=flat-square)](LICENSE)
[![pi](https://img.shields.io/badge/pi-package-7c3aed?style=flat-square)](https://github.com/badlogic/pi-mono)

</div>

---

## Install

From npm:

```bash
pi install npm:pi-glance
```

Or clone as a traditional pi extension directory:

```bash
git clone https://github.com/LinYS77/pi-glance.git ~/.pi/agent/extensions/pi-glance
```

Then restart pi or run `/reload`.

For development/testing:

```bash
pi -e /path/to/pi-glance
```

Local Git diagnostics:

```bash
npm run test:git
npm run debug:git
```

## Use

```text
/glance
```

That's the only command — opens a calm settings pane with a home screen and per-segment detail pages.

## What you see


![pi-glance demo](https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/demo.gif)


| | | |
|---|---|---|
| 🖊️ | **Rounded editor** | Configurable 2 / 3 / 4 min rows, preserves all pi defaults |
| 🏷️ | **Project title** | Current folder name on the top-left border |
| 📊 | **Inline status** | Model · context · tokens · cost · Git status — top-right |
| ⚙️ | **`/glance` pane** | General settings, segment order, and per-segment detail settings — Save / Cancel |
| 💤 | **Dim unfocused** | Surface quiets down when you scroll the chat |
| 🎨 | **Two themes** | `light` and `dark` with tuned grey-green borders |

## Notes

- Icons default to `plain` so pi-glance works with normal terminal fonts.
- If you use a Nerd Font, open `/glance` and set `Icons` to `nerd` for richer symbols.

## Git status

The Git segment is intentionally quiet:

- Clean repositories show only the branch name.
- Dirty repositories add `*` in plain mode or `●` in Nerd Font mode.
- Conflicts add `!` in plain mode or `⚠` in Nerd Font mode.
- Ahead/behind counts appear when Git reports an upstream, for example `↑2 ↓1`.
- Non-Git directories hide the Git segment.

Open `/glance`, select **Git**, and press Enter to configure:

- `Dirty marker` — hide/show normal dirty markers; conflict markers stay visible.
- `Ahead / behind` — hide/show upstream counts.
- `SHA` — `off`, `detached`, or `always`.
- `Polling` — `2s`, `5s`, `10s`, or `30s`.

Git is collected asynchronously and cached. External file changes usually appear within a few seconds. For local development/debugging you can compare pi-glance with Git directly:

```bash
git status --short --branch
npm run debug:git
```

## Design

- No pi core patches — public extension APIs only
- No render-time IO — Git is collected asynchronously and cached
- Global config at `~/.pi/agent/pi-glance/config.json`

## License

[MIT](LICENSE) © 2026 linys77
