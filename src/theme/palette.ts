import { GLANCE_THEME_CATALOG } from "./catalog.js";
import type { GlancePalette, GlanceThemeName, IconMode, IconSet, Rgb } from "../types.js";

export const PALETTES: Record<GlanceThemeName, GlancePalette> = Object.fromEntries(
	GLANCE_THEME_CATALOG.map((theme) => [theme.id, theme.palette]),
) as Record<GlanceThemeName, GlancePalette>;

export const ICONS: Record<IconMode, IconSet> = {
	nerd: {
		git: "",
		model: "󰚩",
		context: "󰔟",
		tokens: "󰄨",
		cost: "󰈸",
		throughput: "",
	},
	plain: {
		git: "git",
		model: "ai",
		context: "ctx",
		tokens: "tok",
		cost: "",
		throughput: "spd",
	},
};

const ANSI256_CUBE_VALUES = [0, 95, 135, 175, 215, 255] as const;
const ANSI256_GRAY_VALUES = Array.from({ length: 24 }, (_, index) => 8 + index * 10);

function closestIndex(value: number, candidates: readonly number[]): number {
	let closest = 0;
	let distance = Number.POSITIVE_INFINITY;
	for (let index = 0; index < candidates.length; index++) {
		const nextDistance = Math.abs(value - candidates[index]!);
		if (nextDistance < distance) {
			closest = index;
			distance = nextDistance;
		}
	}
	return closest;
}

function colorDistance(color: Rgb, candidate: Rgb): number {
	const red = color.r - candidate.r;
	const green = color.g - candidate.g;
	const blue = color.b - candidate.b;
	return red * red * 0.299 + green * green * 0.587 + blue * blue * 0.114;
}

export function rgbToAnsi256(color: Rgb): number {
	const redIndex = closestIndex(color.r, ANSI256_CUBE_VALUES);
	const greenIndex = closestIndex(color.g, ANSI256_CUBE_VALUES);
	const blueIndex = closestIndex(color.b, ANSI256_CUBE_VALUES);
	const cubeColor = {
		r: ANSI256_CUBE_VALUES[redIndex]!,
		g: ANSI256_CUBE_VALUES[greenIndex]!,
		b: ANSI256_CUBE_VALUES[blueIndex]!,
	};
	const cubeIndex = 16 + 36 * redIndex + 6 * greenIndex + blueIndex;
	const cubeDistance = colorDistance(color, cubeColor);

	const luminance = Math.round(0.299 * color.r + 0.587 * color.g + 0.114 * color.b);
	const grayOffset = closestIndex(luminance, ANSI256_GRAY_VALUES);
	const grayValue = ANSI256_GRAY_VALUES[grayOffset]!;
	const grayDistance = colorDistance(color, { r: grayValue, g: grayValue, b: grayValue });
	const saturationSpread = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
	return saturationSpread < 10 && grayDistance < cubeDistance ? 232 + grayOffset : cubeIndex;
}

function rgbToFg(color: Rgb): string {
	return `\x1b[38;2;${color.r};${color.g};${color.b}m`;
}

function rgbToAnsi256Fg(color: Rgb): string {
	return `\x1b[38;5;${rgbToAnsi256(color)}m`;
}

export function fg(color: Rgb, text: string): string {
	return `${rgbToFg(color)}${text}\x1b[39m`;
}

export function fg256(color: Rgb, text: string): string {
	return `${rgbToAnsi256Fg(color)}${text}\x1b[39m`;
}
