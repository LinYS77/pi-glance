export type GlanceThemeGroup = "core" | "catppuccin" | "classic" | "editor" | "kanagawa" | "everforest" | "accessibility";
export type GlanceThemeTone = "light" | "dark";

type GlanceThemeDefinition = {
	id: string;
	label: string;
	group: GlanceThemeGroup;
	tone: GlanceThemeTone;
	tags: readonly string[];
	description: string;
};

// Curated user-facing theme order; this is intentionally not a theme marketplace.
export const GLANCE_THEMES = [
	{
		id: "light",
		label: "Light",
		group: "core",
		tone: "light",
		tags: ["default", "bright", "neutral"],
		description: "Bright neutral palette for well-lit terminals.",
	},
	{
		id: "dark",
		label: "Dark",
		group: "core",
		tone: "dark",
		tags: ["default", "dark", "neutral"],
		description: "Neutral dark palette for low-light terminals.",
	},
	{
		id: "catppuccin-latte",
		label: "Catppuccin Latte",
		group: "catppuccin",
		tone: "light",
		tags: ["pastel", "warm", "gentle"],
		description: "Soft Catppuccin palette with warm light tones.",
	},
	{
		id: "catppuccin-mocha",
		label: "Catppuccin Mocha",
		group: "catppuccin",
		tone: "dark",
		tags: ["pastel", "warm", "gentle"],
		description: "Soft Catppuccin palette with warm dark tones.",
	},
	{
		id: "nord",
		label: "Nord",
		group: "editor",
		tone: "dark",
		tags: ["cool", "arctic", "muted"],
		description: "Cool arctic palette with muted blues.",
	},
	{
		id: "tokyo-night",
		label: "Tokyo Night",
		group: "editor",
		tone: "dark",
		tags: ["cool", "vivid", "night"],
		description: "Deep blue palette with vivid accents.",
	},
	{
		id: "gruvbox-dark",
		label: "Gruvbox Dark",
		group: "classic",
		tone: "dark",
		tags: ["warm", "retro", "earthy"],
		description: "Warm retro palette with earthy contrast.",
	},
	{
		id: "solarized-dark",
		label: "Solarized Dark",
		group: "classic",
		tone: "dark",
		tags: ["classic", "low-contrast", "cyan"],
		description: "Classic dark palette with restrained contrast.",
	},
	{
		id: "rose-pine",
		label: "Rosé Pine",
		group: "editor",
		tone: "dark",
		tags: ["soft", "rose", "muted"],
		description: "Muted rosy palette with gentle contrast.",
	},
	{
		id: "one-dark",
		label: "One Dark",
		group: "editor",
		tone: "dark",
		tags: ["editor", "balanced", "blue"],
		description: "Balanced dark editor palette with blue accents.",
	},
	{
		id: "one-light",
		label: "One Light",
		group: "editor",
		tone: "light",
		tags: ["editor", "balanced", "bright"],
		description: "Balanced bright editor palette with crisp blue accents.",
	},
	{
		id: "solarized-light",
		label: "Solarized Light",
		group: "classic",
		tone: "light",
		tags: ["classic", "low-contrast", "cyan"],
		description: "Classic bright palette with restrained contrast.",
	},
	{
		id: "gruvbox-light",
		label: "Gruvbox Light",
		group: "classic",
		tone: "light",
		tags: ["warm", "retro", "parchment"],
		description: "Warm retro palette with parchment tones.",
	},
	{
		id: "rose-pine-dawn",
		label: "Rosé Pine Dawn",
		group: "editor",
		tone: "light",
		tags: ["soft", "rose", "dawn"],
		description: "Soft dawn palette with rosy accents.",
	},
	{
		id: "catppuccin-frappe",
		label: "Catppuccin Frappé",
		group: "catppuccin",
		tone: "dark",
		tags: ["pastel", "muted", "gentle"],
		description: "Muted Catppuccin palette with cool dusk tones.",
	},
	{
		id: "catppuccin-macchiato",
		label: "Catppuccin Macchiato",
		group: "catppuccin",
		tone: "dark",
		tags: ["pastel", "balanced", "gentle"],
		description: "Balanced Catppuccin palette with medium contrast.",
	},
	{
		id: "kanagawa-wave",
		label: "Kanagawa Wave",
		group: "kanagawa",
		tone: "dark",
		tags: ["ink", "wave", "muted"],
		description: "Ink-toned palette with calm blue-green accents.",
	},
	{
		id: "kanagawa-lotus",
		label: "Kanagawa Lotus",
		group: "kanagawa",
		tone: "light",
		tags: ["lotus", "warm", "calm"],
		description: "Warm paper-toned palette with calm ink accents.",
	},
	{
		id: "everforest-dark",
		label: "Everforest Dark",
		group: "everforest",
		tone: "dark",
		tags: ["forest", "warm", "muted"],
		description: "Warm forest palette with softened contrast.",
	},
	{
		id: "everforest-light",
		label: "Everforest Light",
		group: "everforest",
		tone: "light",
		tags: ["forest", "warm", "soft"],
		description: "Soft forest palette with warm daylight tones.",
	},
	{
		id: "high-contrast-dark",
		label: "High Contrast Dark",
		group: "accessibility",
		tone: "dark",
		tags: ["contrast", "clear", "accessible"],
		description: "High-contrast palette for maximum terminal clarity.",
	},
	{
		id: "high-contrast-light",
		label: "High Contrast Light",
		group: "accessibility",
		tone: "light",
		tags: ["contrast", "clear", "accessible"],
		description: "High-contrast bright palette for maximum terminal clarity.",
	},
] as const satisfies readonly GlanceThemeDefinition[];

export type GlanceThemeMetadata = (typeof GLANCE_THEMES)[number];
export type GlanceThemeName = GlanceThemeMetadata["id"];

export const GLANCE_THEME_IDS = GLANCE_THEMES.map((theme) => theme.id) as readonly GlanceThemeName[];
export const GLANCE_THEME_ID_SET: ReadonlySet<GlanceThemeName> = new Set(GLANCE_THEME_IDS);

export function isGlanceThemeName(value: unknown): value is GlanceThemeName {
	return typeof value === "string" && GLANCE_THEME_ID_SET.has(value as GlanceThemeName);
}

export function themeLabel(theme: GlanceThemeName): string {
	return GLANCE_THEMES.find((metadata) => metadata.id === theme)?.label ?? theme;
}
