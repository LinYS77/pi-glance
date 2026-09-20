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

- **Rounded editor** — Pi's editing, history, autocomplete, and keybindings stay the same.
- **Adaptive status line** — Git · Cost · Model speed · Context · Tokens · Extensions · Model. Model is the last item hidden.
- **Prompt stash** — `alt+s` puts a prompt aside. Press again to restore or swap with current input.
- **Working animation** — a full-border or top-edge sweep, with adjustable speed and nine theme-matched color choices.
- **22 palettes** — light and dark choices with live preview.

No runtime dependencies. No telemetry.

## Configure

Run `/glance` for **Appearance**, **Status line**, **Working**, and **Input** settings. `Tab` switches sections, arrows adjust, and `S` saves.

The full-width preview stays below the settings. Closing keeps your input and cursor position.

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/settings.png" alt="pi-glance settings pane">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/themes.gif" alt="pi-glance theme preview">
</p>

Previews use example data.

## Notes

- Nerd Font icons are enabled by default. For regular fonts, select `Plain` in `/glance` → **Appearance** → **Icons**.
- Git defaults and upgrades use **Summary**: changed files and tracked `+ / −` lines. **Auto fetch** updates the upstream every 5 minutes; turn it off under **Status line → Git**.
- Drafts are stored locally per session, survive reloads, and are deleted on restore. `--no-session` keeps them in memory only.
- **Extensions** shows status text published by compatible plugins. Toggle, reorder or inspect it under **Status line**; empty groups stay hidden.
- Other editor or footer extensions may override parts of Glance's display.
- Requires Pi 0.85.0+ and Node.js 22.19.0 or newer. Pi 0.85.1 is recommended.

## Update

```bash
pi update npm:pi-glance
```

## Contributing

Issues and pull requests are welcome. Development notes: [CONTEXT.md](./CONTEXT.md).

## License

[MIT](LICENSE) © 2026 linys77
