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
- **Adaptive status line** — Git · Cost · Model speed · Context · Tokens · Model. Folds as the terminal narrows.
- **Working animation** — a sweep across the workspace title and connecting line while Pi works.
- **22 palettes** — separate light and dark choices with live preview.

No runtime dependencies. No telemetry.

## Configure

Run `/glance` to choose palettes, toggle status items, and change their order. Changes preview live; press `S` to save.

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/settings.png" alt="pi-glance settings pane">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/themes.gif" alt="pi-glance theme preview">
</p>

## Notes

- Nerd Font icons are enabled by default. For regular fonts, select `plain` in `/glance` → **General** → **Icons**.
- Pi has one custom-editor slot; the last editor extension loaded wins.
- Tested with Pi 0.84.4 and 0.85.1. Requires Node.js 22.19.0 or newer.

## Update

```bash
pi update npm:pi-glance
```

## Contributing

Issues and pull requests are welcome. See [CONTEXT.md](./CONTEXT.md) for development notes.

## License

[MIT](LICENSE) © 2026 linys77
