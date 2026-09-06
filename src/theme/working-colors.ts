import type { GlanceThemeName, Rgb } from "../types.js";

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
