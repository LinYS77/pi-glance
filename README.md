<div align="center">

# ◌ pi-glance

**A rounded editor and status line for [Pi](https://github.com/earendil-works/pi).**

English · [简体中文](./README.zh-CN.md)

[![npm](https://img.shields.io/npm/v/pi-glance?style=flat-square&color=blue)](https://www.npmjs.com/package/pi-glance)
[![CI](https://github.com/LinYS77/pi-glance/actions/workflows/ci.yml/badge.svg)](https://github.com/LinYS77/pi-glance/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-64748b?style=flat-square)](LICENSE)
[![pi](https://img.shields.io/badge/pi-package-7c3aed?style=flat-square)](https://pi.dev/packages/pi-glance)

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/input-surface.png" alt="pi-glance input surface">
</p>

## Install

```bash
# Try it for one session
pi -e npm:pi-glance

# Or install it
pi install npm:pi-glance
```

Restart Pi or run `/reload`.

## Features

- **Rounded editor** — Pi's editing, history, autocomplete and keybindings stay unchanged.
- **Adaptive status line** — Git · Cost · Model speed · Context · Tokens · Extensions · Model. Model is the last item hidden.
- **Prompt stash** — `alt+s` puts input aside; press again to restore or swap.
- **Activity** — bottom-border text, or sweeps for work/summaries and blinking for retries. Adjust speed, color, summary multiplier and blink rate.
- **22 palettes** — light and dark choices with live preview.

No runtime dependencies. No telemetry.

## Configure

Run `/glance` for **Appearance**, **Status line**, **Activity**, and **Input** settings. `Tab` switches sections, arrows adjust, and `S` saves.

The full-width preview sits below settings. Closing preserves input and cursor.

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/settings.png" alt="pi-glance settings pane">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/themes.gif" alt="pi-glance theme preview">
</p>

Previews use example data.

## Notes

- Nerd Font icons are enabled by default. For regular fonts, select `Plain` in `/glance` → **Appearance** → **Icons**.
- Upgrading switches activity to **Text**. Choose **Sweep** under **Activity** to restore effects; previous speeds and colors are kept.
- Git **Summary** shows changed files and tracked `+ / −` lines. **Auto fetch** checks upstream every 5 minutes; disable under **Status line → Git**.
- Drafts persist per session until restored. `--no-session` keeps them in memory.
- **Extensions** shows compatible plugins' status text. Toggle, reorder or inspect under **Status line**; empty groups stay hidden.
- Other editor or footer extensions may override parts of Glance's display.
- Requires Pi 0.86.1+ and Node.js 22.19.0 or newer.

## Update

```bash
pi update npm:pi-glance
```

## Contributing

Issues and pull requests are welcome. Development notes: [CONTEXT.md](./CONTEXT.md).

## License

[MIT](LICENSE) © 2026 linys77
