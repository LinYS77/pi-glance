<div align="center">

# ◌ pi-glance

**A calm input surface for [pi](https://github.com/badlogic/pi-mono)**

Replace the default prompt with a rounded multiline editor
and an inline glance at model, context, tokens, cost, and branch.

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

## Use

```text
/glance
```

That's the only command — opens a configuration pane to tweak theme, icons, segments, and more.

## What you see


![pi-glance demo](assets/demo.gif)


| | | |
|---|---|---|
| 🖊️ | **Rounded editor** | Configurable 2 / 3 / 4 min rows, preserves all pi defaults |
| 🏷️ | **Project title** | Current folder name on the top-left border |
| 📊 | **Inline status** | Model · context · tokens · cost · git branch — top-right |
| ⚙️ | **`/glance` pane** | Theme, icons, segments, visibility — Save / Cancel |
| 💤 | **Dim unfocused** | Surface quiets down when you scroll the chat |
| 🎨 | **Two themes** | `light` and `dark` with tuned grey-green borders |

## Design

- No pi core patches — public extension APIs only
- No render-time IO — no shell, file, or network calls during rendering
- Global config at `~/.pi/agent/pi-glance/config.json`

## License

[MIT](LICENSE) © 2026 linys77
