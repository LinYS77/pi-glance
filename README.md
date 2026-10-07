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
- **Adaptive status line** — Git · Cost · Output throughput · Context · Tokens · Extensions · Model. Model is the last item hidden.
- **Prompt stash** — `alt+s` puts input aside; press again to restore or swap.
- **Activity** — bottom-border text, or sweeps for work/summaries and blinking for retries. Adjust speed, color, summary multiplier and blink rate.
- **22 palettes** — light and dark choices with live preview.

No runtime dependencies. No telemetry.

### Output throughput

`tok/s` is **average output throughput**, not raw decode speed: total provider-reported output tokens (including reasoning and tool calls), divided by the summed observed request durations. Reasoning is already included in output and is neither subtracted nor added again. Timing includes initial latency and thinking, but excludes tool execution, gaps between requests and blocking UI prompts.

Pi session-level retries exclude failed attempts and their backoff. SDK-internal or upstream retries may remain inside the observed request duration; their waiting time cannot be reliably separated.

`~` marks the average of completed requests in the current run; it becomes final when the run settles. A fresh run clears the old rate. Missing or ambiguous boundaries, or invalid timing/output usage, show unknown; no tokens are guessed from chunks, and no speed cap is applied.

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
- Activity defaults to **Text**. Choose **Sweep** under **Activity** for border effects.
- Git **Summary** shows changed files and tracked `+ / −` lines. **Auto fetch** checks upstream every 5 minutes; disable under **Status line → Git**.
- Drafts persist per session until restored. `--no-session` keeps them in memory.
- **Extensions** shows compatible plugins' status text. Toggle, reorder or inspect under **Status line**; empty groups stay hidden.
- Other editor or footer extensions may override parts of Glance's display.
- Requires Pi 1.0.0+ and Node.js 22.19.0 or newer.

## Update

```bash
pi update npm:pi-glance
```

## Contributing

Issues and pull requests are welcome. Development notes: [CONTEXT.md](./CONTEXT.md).

## License

[MIT](LICENSE) © 2026 linys77
