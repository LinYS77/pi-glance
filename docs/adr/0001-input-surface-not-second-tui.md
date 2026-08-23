# ADR 0001: Remain a Pi input surface, not a second TUI

- Status: Accepted
- Date: 2026-08-23

## Context

pi-glance began as a compact way to frame Pi's editor and expose nearby status facts. Fixed-editor and fullscreen experiments showed that selection, copy, hit testing, sticky footer layout, and independent editor composition require Pi-owned seams.

Implementing those behaviors inside pi-glance would require terminal interception, Pi/TUI patches, or a parallel screen model.

## Decision

pi-glance remains an input-surface extension built on Pi's public custom-editor and footer interfaces.

It may decorate the Pi editor, render compact status facts, and provide `/glance` configuration. It will not become an independent TUI, fullscreen dashboard, fixed-editor implementation, or terminal compositor.

Fixed regions or unified selection/copy may be revisited only if Pi exposes public layout, hit-test, and selection seams.

## Consequences

- Pi retains editing, selection, IME, history, autocomplete, and layout ownership.
- The project stays small enough to follow Pi compatibility changes.
- The fullscreen empty footer row remains an accepted Pi limitation.
- Features that require terminal interception are rejected rather than approximated unsafely.
