import type { GlancePalette, GlanceThemeName, IconMode, IconSet, Rgb } from "./types.js";

export const PALETTES: Record<GlanceThemeName, GlancePalette> = {
	light: {
		name: "light",
		text: { r: 15, g: 23, b: 42 },
		dim: { r: 148, g: 163, b: 184 },
		warn: { r: 217, g: 119, b: 6 },
		error: { r: 225, g: 29, b: 72 },
		separator: { r: 148, g: 163, b: 184 },
		border: { r: 72, g: 94, b: 84 },
		title: { r: 47, g: 104, b: 74 },
		segments: {
			"git.branch": { fg: { r: 35, g: 118, b: 85 } },
			model: { fg: { r: 15, g: 23, b: 42 } },
			context: { fg: { r: 5, g: 150, b: 105 } },
			tokens: { fg: { r: 100, g: 116, b: 139 } },
			cost: { fg: { r: 154, g: 104, b: 20 } },
		},
	},
	dark: {
		name: "dark",
		text: { r: 229, g: 231, b: 235 },
		dim: { r: 107, g: 114, b: 128 },
		warn: { r: 251, g: 191, b: 36 },
		error: { r: 251, g: 113, b: 133 },
		separator: { r: 75, g: 85, b: 99 },
		border: { r: 104, g: 132, b: 119 },
		title: { r: 104, g: 152, b: 129 },
		segments: {
			"git.branch": { fg: { r: 94, g: 188, b: 145 } },
			model: { fg: { r: 229, g: 231, b: 235 } },
			context: { fg: { r: 52, g: 211, b: 153 } },
			tokens: { fg: { r: 156, g: 163, b: 175 } },
			cost: { fg: { r: 251, g: 191, b: 36 } },
		},
	},
};

export const ICONS: Record<IconMode, IconSet> = {
	nerd: {
		"git.branch": "",
		model: "󰚩",
		context: "󰔟",
		tokens: "󰄨",
		cost: "󰈸",
	},
	plain: {
		"git.branch": "git",
		model: "ai",
		context: "ctx",
		tokens: "tok",
		cost: "$",
	},
};

export function rgbToFg(color: Rgb): string {
	return `\x1b[38;2;${color.r};${color.g};${color.b}m`;
}

export function fg(color: Rgb, text: string): string {
	return `${rgbToFg(color)}${text}\x1b[39m`;
}
