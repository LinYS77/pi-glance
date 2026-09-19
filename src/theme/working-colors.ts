import type { GlanceThemeName, Rgb, WorkingSweepColor } from "../types.js";

function rgb(hex: number): Rgb {
	return { r: hex >> 16 & 255, g: hex >> 8 & 255, b: hex & 255 };
}

// One Working accent for both title and connector. Keep this separate from
// status/warning colors: movement should not change the meaning of any fact.
// Validate the displayed colors in RGB and ANSI256, not just the source RGBs.
export const WORKING_ACCENTS = {
	light: rgb(0xaf00af),
	dark: rgb(0xffd75f),
	"catppuccin-latte": rgb(0x875f00),
	"catppuccin-mocha": rgb(0xf9d88f),
	nord: rgb(0xffd75f),
	"tokyo-night": rgb(0xffc777),
	"gruvbox-dark": rgb(0xd386d7),
	"solarized-dark": rgb(0xffaf5f),
	"rose-pine": rgb(0xffef5f),
	"one-dark": rgb(0xffd787),
	"one-light": rgb(0xa526a4),
	"solarized-light": rgb(0xaf005f),
	"gruvbox-light": rgb(0x8700af),
	"rose-pine-dawn": rgb(0xaf005f),
	"catppuccin-frappe": rgb(0xef9f76),
	"catppuccin-macchiato": rgb(0xf0cb7f),
	"kanagawa-wave": rgb(0xffaf5f),
	"kanagawa-lotus": rgb(0xaf005f),
	"everforest-dark": rgb(0xffafdf),
	"everforest-light": rgb(0x8700af),
	"high-contrast-dark": rgb(0xffff00),
	"high-contrast-light": rgb(0xaf00af),
} satisfies Record<GlanceThemeName, Rgb>;

// Theme-family accents, with deeper light variants and brighter dark variants.
// These are beam peaks, not replacements for the theme's status or border colors.
const COLOR_PRESETS = {
	light: { amber: 0x926000, rose: 0xb42b66, violet: 0x704aa0, blue: 0x2563b0,
		teal: 0x00627a, mint: 0x00502b, coral: 0xa42c2b, copper: 0x865033 },
	dark: { amber: 0xffd75f, rose: 0xff9bb0, violet: 0xd7afff, blue: 0xafcfff,
		teal: 0x5fd7d7, mint: 0x9ae6b4, coral: 0xff9b87, copper: 0xe5b087 },
	"catppuccin-latte": { amber: 0x875f00, rose: 0xb12f63, violet: 0x882bd9, blue: 0x1e50b3,
		teal: 0x00707c, mint: 0x26652b, coral: 0xbf2e20, copper: 0x815030 },
	"catppuccin-mocha": { amber: 0xf9e2af, rose: 0xf5c2e7, violet: 0xcba6f7, blue: 0xb4dcff,
		teal: 0x94e2d5, mint: 0xa6e3a1, coral: 0xfab387, copper: 0xcfa07b },
	nord: { amber: 0xebcb8b, rose: 0xeca5b4, violet: 0xd6b3d6, blue: 0xb5d9f3,
		teal: 0x8fe3dd, mint: 0xabe3b5, coral: 0xefa58f, copper: 0xd7a581 },
	"tokyo-night": { amber: 0xffc777, rose: 0xff9eae, violet: 0xd6b5ff, blue: 0xcedbff,
		teal: 0x73ead0, mint: 0xa9df97, coral: 0xff9e64, copper: 0xe0ad87 },
	"gruvbox-dark": { amber: 0xfabd2f, rose: 0xfb9b9b, violet: 0xd386d7, blue: 0x9fd0f0,
		teal: 0x8ecfc1, mint: 0xb8d77d, coral: 0xfb9273, copper: 0xdba06b },
	"solarized-dark": { amber: 0xffaf5f, rose: 0xff9faf, violet: 0xd7afff, blue: 0x9fcfff,
		teal: 0x5fd7c7, mint: 0xa4d8a0, coral: 0xff9b75, copper: 0xdca078 },
	"rose-pine": { amber: 0xf6c177, rose: 0xf2b5bc, violet: 0xf3c5ff, blue: 0xa6bfff,
		teal: 0x9af2e2, mint: 0xa5efb4, coral: 0xefa999, copper: 0xd9a380 },
	"one-dark": { amber: 0xe5c07b, rose: 0xefa5ad, violet: 0xdca8ef, blue: 0xafd7ff,
		teal: 0x70dfd0, mint: 0xaedb95, coral: 0xefa38b, copper: 0xd4a06c },
	"one-light": { amber: 0x956200, rose: 0xb02e66, violet: 0xa526a4, blue: 0x2059ad,
		teal: 0x006970, mint: 0x286527, coral: 0xa92e2b, copper: 0x83512c },
	"solarized-light": { amber: 0x986200, rose: 0xb82b65, violet: 0x7055b0, blue: 0x1c60a1,
		teal: 0x006a75, mint: 0x365f23, coral: 0xad2e24, copper: 0x85522e },
	"gruvbox-light": { amber: 0x946000, rose: 0x983b58, violet: 0x8f3f8f, blue: 0x285b8a,
		teal: 0x006773, mint: 0x4f6300, coral: 0xa12d26, copper: 0x854a26 },
	"rose-pine-dawn": { amber: 0x926000, rose: 0x993d68, violet: 0x7053a1, blue: 0x28657f,
		teal: 0x206576, mint: 0x2d6141, coral: 0xac2e2b, copper: 0x87522f },
	"catppuccin-frappe": { amber: 0xe5c890, rose: 0xeebebe, violet: 0xca9ee6, blue: 0xb5d5fc,
		teal: 0x81dbc8, mint: 0xa7d890, coral: 0xeea68b, copper: 0xce9b75 },
	"catppuccin-macchiato": { amber: 0xeed49f, rose: 0xf0b8cc, violet: 0xc6a0f6, blue: 0xb2d5ff,
		teal: 0x8bdfcb, mint: 0xa8dc94, coral: 0xf5a68a, copper: 0xd8a07b },
	"kanagawa-wave": { amber: 0xe6c384, rose: 0xeaa5a9, violet: 0xc5ace5, blue: 0xb4d6ef,
		teal: 0x7bd9ca, mint: 0xbdd685, coral: 0xeaa085, copper: 0xcfa073 },
	"kanagawa-lotus": { amber: 0x916300, rose: 0xab2c60, violet: 0x7052a7, blue: 0x355e9b,
		teal: 0x17646c, mint: 0x4b602a, coral: 0xa32d2b, copper: 0x81512f },
	"everforest-dark": { amber: 0xdbbc7f, rose: 0xe8a0ae, violet: 0xd6b0df, blue: 0x9fd1f3,
		teal: 0x8fe0c9, mint: 0xbedc9b, coral: 0xf0a28b, copper: 0xd8a179 },
	"everforest-light": { amber: 0x8f6400, rose: 0xa92c60, violet: 0x70529f, blue: 0x2b6390,
		teal: 0x006775, mint: 0x426400, coral: 0xa32e2a, copper: 0x815529 },
	"high-contrast-dark": { amber: 0xffff00, rose: 0xff87af, violet: 0xffafff, blue: 0x87d7ff,
		teal: 0x5fffff, mint: 0xafff87, coral: 0xff875f, copper: 0xffaf5f },
	"high-contrast-light": { amber: 0x875f00, rose: 0xaf005f, violet: 0x8700af, blue: 0x0000af,
		teal: 0x0066af, mint: 0x005f00, coral: 0xaf0000, copper: 0x875f5f },
} satisfies Record<GlanceThemeName, Record<Exclude<WorkingSweepColor, "theme">, number>>;

export function workingAccent(theme: GlanceThemeName, color: WorkingSweepColor = "theme"): Rgb {
	return color === "theme" ? WORKING_ACCENTS[theme] : rgb(COLOR_PRESETS[theme][color]);
}
