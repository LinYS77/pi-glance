<div align="center">

# ◌ pi-glance

**A calm input surface for [Pi](https://github.com/earendil-works/pi).**

A rounded multiline editor with an adaptive glance at<br>
Git, cost, model speed, context, tokens, and model.

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

## What it adds

- **Rounded editor** — keeps Pi's editing, history, autocomplete, and keybindings.
- **Adaptive glance** — Git · Cost · Model speed · Context · Tokens · Model.
- **22 palettes** — separate light and dark choices, previewed live.
- **One settings pane** — everything display-related lives under `/glance`.
- **Quiet by default** — plain icons, no telemetry, and no runtime dependencies.

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

## Notes

- Plain icons work with normal terminal fonts. Nerd Font icons are optional in `/glance` → **General** → **Icons**.
- Pi provides one custom-editor slot, so the last editor extension loaded wins.
- Built and tested with Pi 0.84.4 on Node.js 22.19.0 or newer.
- Uses only public Pi extension APIs.

## Update

```bash
pi update npm:pi-glance
```

## Contributing

Issues and pull requests are welcome. For implementation details, see [CONTEXT.md](./CONTEXT.md) and the [architecture decisions](./docs/adr/).

## License

[MIT](LICENSE) © 2026 linys77
