import { GLANCE_THEME_CATALOG } from "./theme-catalog.js";

type ThemeCatalogMetadataShape = {
	readonly id: string;
	readonly label: string;
	readonly group: string;
	readonly tone: string;
	readonly tags: readonly string[];
	readonly description: string;
};

type ThemeMetadataProjection<Entry extends ThemeCatalogMetadataShape> = {
	readonly id: Entry["id"];
	readonly label: Entry["label"];
	readonly group: Entry["group"];
	readonly tone: Entry["tone"];
	readonly tags: Entry["tags"];
	readonly description: Entry["description"];
};

type ThemeMetadataCatalog<Catalog extends readonly ThemeCatalogMetadataShape[]> = {
	readonly [Index in keyof Catalog]: Catalog[Index] extends ThemeCatalogMetadataShape ? ThemeMetadataProjection<Catalog[Index]> : never;
};

type ThemeIdCatalog<Catalog extends readonly ThemeCatalogMetadataShape[]> = {
	readonly [Index in keyof Catalog]: Catalog[Index] extends ThemeCatalogMetadataShape ? Catalog[Index]["id"] : never;
};

export type GlanceThemeGroup = (typeof GLANCE_THEME_CATALOG)[number]["group"];
export type GlanceThemeTone = (typeof GLANCE_THEME_CATALOG)[number]["tone"];

// Curated user-facing theme order; this is intentionally not a theme marketplace.
export const GLANCE_THEMES = GLANCE_THEME_CATALOG.map(({ id, label, group, tone, tags, description }) => ({
	id,
	label,
	group,
	tone,
	tags,
	description,
})) as unknown as ThemeMetadataCatalog<typeof GLANCE_THEME_CATALOG>;

export type GlanceThemeMetadata = (typeof GLANCE_THEMES)[number];
export type GlanceThemeName = (typeof GLANCE_THEME_CATALOG)[number]["id"];

export const GLANCE_THEME_IDS = GLANCE_THEME_CATALOG.map((theme) => theme.id) as unknown as ThemeIdCatalog<typeof GLANCE_THEME_CATALOG>;
export const GLANCE_THEME_ID_SET: ReadonlySet<GlanceThemeName> = new Set(GLANCE_THEME_IDS);

export function isGlanceThemeName(value: unknown): value is GlanceThemeName {
	return typeof value === "string" && GLANCE_THEME_ID_SET.has(value as GlanceThemeName);
}

export function themeLabel(theme: GlanceThemeName): string {
	return GLANCE_THEMES.find((metadata) => metadata.id === theme)?.label ?? theme;
}
