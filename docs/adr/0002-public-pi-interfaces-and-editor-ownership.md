# ADR 0002: Use only public Pi interfaces and restore owned editor state safely

- Status: Accepted
- Date: 2026-08-23

## Context

Pi extensions share one custom-editor factory slot. Last writer wins, and Pi does not provide generic editor middleware. Pi does expose `ctx.ui.getEditorComponent()` for observing the current factory, but it does not expose an equivalent footer getter.

Private imports or duck-typed wrapping would couple pi-glance to implementation details and could clobber other extensions.

## Decision

Production code imports Pi only through exported package roots and uses documented public context/UI interfaces.

When installing the Glance editor, runtime records both its own factory and the factory it replaced. On disable or shutdown, it restores the predecessor only when `getEditorComponent()` still equals the Glance-owned factory.

Enabled-to-enabled config saves reuse the current editor instance. pi-glance does not wrap arbitrary third-party editors.

Footer cleanup remains best-effort because Pi has no public footer ownership query. No private workaround is permitted.

## Consequences

- Disabling or unloading pi-glance does not erase a newer third-party editor.
- Prompt editing state survives ordinary `/glance` saves.
- Two custom-editor extensions remain load-order dependent.
- Better editor composition and zero-height footer behavior require upstream Pi seams.
