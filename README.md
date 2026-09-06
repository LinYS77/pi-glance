<div align="center">

# ◌ pi-glance

**A rounded editor and status line for [Pi](https://github.com/earendil-works/pi).**

Shows Git status, cost, model speed, context usage, tokens, and the current model.

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

- **Rounded editor** — keeps Pi's editing, history, autocomplete, and keybindings.
- **Adaptive status line** — Git · Cost · Model speed · Context · Tokens · Model.
- **Working animation** — a moving highlight on the path and connecting line, enabled by default. Status values stay still.
- **22 palettes** — separate light and dark choices, previewed live.
- **Settings** — use `/glance` to choose palettes, toggle segments, and change their order.

Plain icons are enabled by default. There are no runtime dependencies and no telemetry.

## Configure

Run:

```text
/glance
```

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/settings.png" alt="pi-glance settings pane">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/themes.gif" alt="pi-glance theme preview">
</p>

Changes preview live. Press `D` to see how the status line folds at full, compact, and minimal widths.

Use **General → Working animation** to turn the sweep off and restore Pi's Working indicator. Select this setting to preview the animation; press `S` to save. Changing it takes effect without replacing the editor or clearing your input.

## Notes

- Plain icons work with normal terminal fonts. Nerd Font icons are optional in `/glance` → **General** → **Icons**.
- Pi provides one custom-editor slot, so the last editor extension loaded wins.
- Built and tested with Pi 0.84.4 and 0.85.1 on Node.js 22.19.0 or newer.
- Glance follows Pi's terminal truecolor capability and falls back to ANSI 256 colors.
- Context warning colors follow Pi's reported percentage, including in tokens-only display.
- Bash input (`!` / `!!`) retains Pi's native border color; normal prompts keep the selected Glance palette.
- Uses only public Pi extension APIs.

## Update

```bash
pi update npm:pi-glance
```

## Contributing

Issues and pull requests are welcome. See [CONTEXT.md](./CONTEXT.md) for the code layout and implementation notes.

Source is in `src/`, tests are in `tests/`, and the Pi extension entry is `index.ts`.

```bash
npm ci
npm run check
npm test
npm run pack:dry
```

## License

[MIT](LICENSE) © 2026 linys77
