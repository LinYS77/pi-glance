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
			git: { fg: { r: 35, g: 118, b: 85 } },
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
			git: { fg: { r: 94, g: 188, b: 145 } },
			model: { fg: { r: 229, g: 231, b: 235 } },
			context: { fg: { r: 52, g: 211, b: 153 } },
			tokens: { fg: { r: 156, g: 163, b: 175 } },
			cost: { fg: { r: 251, g: 191, b: 36 } },
		},
	},
	"catppuccin-latte": {
		name: "catppuccin-latte",
		text: { r: 76, g: 79, b: 105 },
		dim: { r: 156, g: 160, b: 176 },
		warn: { r: 223, g: 142, b: 29 },
		error: { r: 210, g: 15, b: 57 },
		separator: { r: 156, g: 160, b: 176 },
		border: { r: 204, g: 208, b: 218 },
		title: { r: 30, g: 102, b: 245 },
		segments: {
			git: { fg: { r: 64, g: 160, b: 43 } },
			model: { fg: { r: 114, g: 135, b: 253 } },
			context: { fg: { r: 23, g: 146, b: 153 } },
			tokens: { fg: { r: 140, g: 143, b: 161 } },
			cost: { fg: { r: 254, g: 100, b: 11 } },
		},
	},
	"catppuccin-mocha": {
		name: "catppuccin-mocha",
		text: { r: 205, g: 214, b: 244 },
		dim: { r: 108, g: 112, b: 134 },
		warn: { r: 249, g: 226, b: 175 },
		error: { r: 243, g: 139, b: 168 },
		separator: { r: 108, g: 112, b: 134 },
		border: { r: 49, g: 50, b: 68 },
		title: { r: 137, g: 180, b: 250 },
		segments: {
			git: { fg: { r: 166, g: 227, b: 161 } },
			model: { fg: { r: 180, g: 190, b: 254 } },
			context: { fg: { r: 148, g: 226, b: 213 } },
			tokens: { fg: { r: 127, g: 132, b: 156 } },
			cost: { fg: { r: 250, g: 179, b: 135 } },
		},
	},
};

export const ICONS: Record<IconMode, IconSet> = {
	nerd: {
		git: "",
		model: "󰚩",
		context: "󰔟",
		tokens: "󰄨",
		cost: "󰈸",
	},
	plain: {
		git: "git",
		model: "ai",
		context: "ctx",
		tokens: "tok",
		cost: "$",
	},
};

function rgbToFg(color: Rgb): string {
	return `\x1b[38;2;${color.r};${color.g};${color.b}m`;
}

export function fg(color: Rgb, text: string): string {
	return `${rgbToFg(color)}${text}\x1b[39m`;
}
