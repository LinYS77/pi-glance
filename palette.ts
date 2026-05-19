import type { GlancePalette, GlanceThemeName, IconMode, IconSet, Rgb } from "./types.js";

export const PALETTES: Record<GlanceThemeName, GlancePalette> = {
	light: {
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
	nord: {
		text: { r: 216, g: 222, b: 233 },
		dim: { r: 76, g: 86, b: 106 },
		warn: { r: 235, g: 203, b: 139 },
		error: { r: 191, g: 97, b: 106 },
		separator: { r: 76, g: 86, b: 106 },
		border: { r: 94, g: 129, b: 172 },
		title: { r: 136, g: 192, b: 208 },
		segments: {
			git: { fg: { r: 163, g: 190, b: 140 } },
			model: { fg: { r: 129, g: 161, b: 193 } },
			context: { fg: { r: 143, g: 188, b: 187 } },
			tokens: { fg: { r: 76, g: 86, b: 106 } },
			cost: { fg: { r: 208, g: 135, b: 112 } },
		},
	},
	"tokyo-night": {
		text: { r: 192, g: 202, b: 245 },
		dim: { r: 86, g: 95, b: 137 },
		warn: { r: 224, g: 175, b: 104 },
		error: { r: 247, g: 118, b: 142 },
		separator: { r: 59, g: 66, b: 97 },
		border: { r: 122, g: 162, b: 247 },
		title: { r: 125, g: 207, b: 255 },
		segments: {
			git: { fg: { r: 158, g: 206, b: 106 } },
			model: { fg: { r: 187, g: 154, b: 247 } },
			context: { fg: { r: 125, g: 207, b: 255 } },
			tokens: { fg: { r: 86, g: 95, b: 137 } },
			cost: { fg: { r: 224, g: 175, b: 104 } },
		},
	},
	"gruvbox-dark": {
		text: { r: 235, g: 219, b: 178 },
		dim: { r: 146, g: 131, b: 116 },
		warn: { r: 250, g: 189, b: 47 },
		error: { r: 251, g: 73, b: 52 },
		separator: { r: 80, g: 73, b: 69 },
		border: { r: 104, g: 157, b: 106 },
		title: { r: 184, g: 187, b: 38 },
		segments: {
			git: { fg: { r: 184, g: 187, b: 38 } },
			model: { fg: { r: 131, g: 165, b: 152 } },
			context: { fg: { r: 142, g: 192, b: 124 } },
			tokens: { fg: { r: 146, g: 131, b: 116 } },
			cost: { fg: { r: 254, g: 128, b: 25 } },
		},
	},
	"solarized-dark": {
		text: { r: 131, g: 148, b: 150 },
		dim: { r: 88, g: 110, b: 117 },
		warn: { r: 181, g: 137, b: 0 },
		error: { r: 220, g: 50, b: 47 },
		separator: { r: 88, g: 110, b: 117 },
		border: { r: 38, g: 139, b: 210 },
		title: { r: 42, g: 161, b: 152 },
		segments: {
			git: { fg: { r: 133, g: 153, b: 0 } },
			model: { fg: { r: 38, g: 139, b: 210 } },
			context: { fg: { r: 42, g: 161, b: 152 } },
			tokens: { fg: { r: 88, g: 110, b: 117 } },
			cost: { fg: { r: 203, g: 75, b: 22 } },
		},
	},
	"rose-pine": {
		text: { r: 224, g: 222, b: 244 },
		dim: { r: 110, g: 106, b: 134 },
		warn: { r: 246, g: 193, b: 119 },
		error: { r: 235, g: 111, b: 146 },
		separator: { r: 64, g: 61, b: 82 },
		border: { r: 156, g: 207, b: 216 },
		title: { r: 196, g: 167, b: 231 },
		segments: {
			git: { fg: { r: 156, g: 207, b: 216 } },
			model: { fg: { r: 196, g: 167, b: 231 } },
			context: { fg: { r: 49, g: 116, b: 143 } },
			tokens: { fg: { r: 110, g: 106, b: 134 } },
			cost: { fg: { r: 246, g: 193, b: 119 } },
		},
	},
	"one-dark": {
		text: { r: 171, g: 178, b: 191 },
		dim: { r: 92, g: 99, b: 112 },
		warn: { r: 229, g: 192, b: 123 },
		error: { r: 224, g: 108, b: 117 },
		separator: { r: 75, g: 82, b: 99 },
		border: { r: 97, g: 175, b: 239 },
		title: { r: 86, g: 182, b: 194 },
		segments: {
			git: { fg: { r: 152, g: 195, b: 121 } },
			model: { fg: { r: 97, g: 175, b: 239 } },
			context: { fg: { r: 86, g: 182, b: 194 } },
			tokens: { fg: { r: 92, g: 99, b: 112 } },
			cost: { fg: { r: 209, g: 154, b: 102 } },
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
