# ADR 0004: Keep Glance palettes separate from Pi theme management

- Status: Accepted
- Date: 2026-08-23

## Context

pi-glance ships 22 curated palettes. Pi also has its own theme catalog and theme-switching interfaces, but using pi-glance as a Pi theme manager would expand the product scope and make rendering depend on Pi token-color internals.

Pi currently exposes the active theme name but not a public light/dark appearance field for arbitrary custom themes.

## Decision

Glance configuration stores two palette slots:

```ts
{ theme: { light: GlanceThemeName, dark: GlanceThemeName } }
```

Both slots can select any Glance palette. At render time, exact Pi theme name `light` selects the light slot and exact name `dark` selects the dark slot. Unknown or custom names fall back to the light slot.

`/glance` does not enumerate, load, install, switch, or render with Pi themes. Terminal background detection and fuzzy name inference are not used.

## Consequences

- Glance visuals remain stable and independently testable.
- Custom Pi themes do not automatically choose a dark Glance slot.
- Accurate custom-theme tone selection must wait for a public Pi appearance seam.
- The 22-palette catalog is treated as a curated product surface, not an endlessly growing theme marketplace.
