// Curated user-facing theme order; this is intentionally not a theme marketplace.
export const GLANCE_THEMES = [
	{ id: "light", label: "Light" },
	{ id: "dark", label: "Dark" },
	{ id: "catppuccin-latte", label: "Catppuccin Latte" },
	{ id: "catppuccin-mocha", label: "Catppuccin Mocha" },
	{ id: "nord", label: "Nord" },
	{ id: "tokyo-night", label: "Tokyo Night" },
	{ id: "gruvbox-dark", label: "Gruvbox Dark" },
	{ id: "solarized-dark", label: "Solarized Dark" },
	{ id: "rose-pine", label: "Rosé Pine" },
	{ id: "one-dark", label: "One Dark" },
] as const;

export type GlanceThemeName = (typeof GLANCE_THEMES)[number]["id"];

export const GLANCE_THEME_IDS = GLANCE_THEMES.map((theme) => theme.id) as readonly GlanceThemeName[];
export const GLANCE_THEME_ID_SET: ReadonlySet<GlanceThemeName> = new Set(GLANCE_THEME_IDS);

export function isGlanceThemeName(value: unknown): value is GlanceThemeName {
	return typeof value === "string" && GLANCE_THEME_ID_SET.has(value as GlanceThemeName);
}

export function themeLabel(theme: GlanceThemeName): string {
	return GLANCE_THEMES.find((metadata) => metadata.id === theme)?.label ?? theme;
}
