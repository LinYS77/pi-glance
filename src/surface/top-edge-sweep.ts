import { visibleWidth } from "@earendil-works/pi-tui";
import type { ResolvedGlanceStyles, TextStyler } from "../theme/adapter.js";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const SINGLE_CELL_TEXT = /^[\x20-\x7e─]*$/;
const TEXT_CACHE_LIMIT = 32;
const MAX_CACHED_TEXT_LENGTH = 1024;

interface MeasuredText {
	offsets: number[];
	centers: number[];
}

const measuredTexts = new Map<string, MeasuredText>();

function measureText(text: string): MeasuredText {
	const cached = measuredTexts.get(text);
	if (cached) {
		measuredTexts.delete(text);
		measuredTexts.set(text, cached);
		return cached;
	}
	const offsets = [0], centers: number[] = [];
	let column = 0;
	for (const { segment, index } of graphemes.segment(text)) {
		const width = visibleWidth(segment);
		centers.push(column + width / 2);
		column += width;
		offsets.push(index + segment.length);
	}
	const measured = { offsets, centers };
	if (text.length <= MAX_CACHED_TEXT_LENGTH) {
		if (measuredTexts.size >= TEXT_CACHE_LIMIT) measuredTexts.delete(measuredTexts.keys().next().value!);
		measuredTexts.set(text, measured);
	}
	return measured;
}

function lowerBound(values: readonly number[], target: number): number {
	let low = 0, high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (values[middle]! < target) low = middle + 1;
		else high = middle;
	}
	return low;
}

export function sweepProfile(width: number, elapsedMs: number): { center: number; radius: number; periodMs: number } {
	const columns = Number.isFinite(width) ? Math.max(0, width) : 0;
	const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
	const radius = Math.max(9, Math.min(28, columns * 0.16));
	const periodMs = Math.max(2000, Math.min(3600, 1200 + columns * 10));
	return { radius, periodMs, center: -radius + (columns + radius * 2) * (elapsed % periodMs) / periodMs };
}

/** A broad, feathered beam across the path and its connecting line only. */
export function createTopEdgeSweep(width: number, elapsedMs: number, styles: ResolvedGlanceStyles) {
	const { center, radius } = sweepProfile(width, elapsedMs);
	return (text: string, style: TextStyler, column: number): string => {
		if (!styles.highlight || !Number.isFinite(column)) return style(text);
		// ASCII paths and box-drawing lines need neither segmentation nor width lookups.
		const measured = SINGLE_CELL_TEXT.test(text) ? undefined : measureText(text);
		const length = measured?.centers.length ?? text.length;
		const low = center - radius - column - 1;
		const high = center + radius - column + 1;
		const first = measured ? lowerBound(measured.centers, low) : Math.max(0, Math.min(length, Math.floor(low)));
		const end = measured ? lowerBound(measured.centers, high) : Math.max(0, Math.min(length, Math.ceil(high)));
		if (first >= end) return style(text);
		const offset = (index: number) => measured ? measured.offsets[index]! : index;
		let result = "";
		let run = text.slice(0, offset(first));
		let previous = style;
		// Only shade glyphs near the beam. Unlit prefix/suffix are emitted in bulk.
		for (let index = first; index < end; index++) {
			const cellCenter = measured ? measured.centers[index]! : index + 0.5;
			const distance = Math.abs(column + cellCenter - center) / radius;
			const strength = Math.max(0, Math.min(1, (1 - distance) / 0.55));
			const smooth = strength * strength * (3 - 2 * strength);
			const next = styles.highlight(style, smooth);
			if (next !== previous && run) {
				result += previous(run);
				run = "";
			}
			run += text.slice(offset(index), offset(index + 1));
			previous = next;
		}
		const suffix = text.slice(offset(end));
		if (suffix && previous !== style && run) {
			result += previous(run);
			run = "";
			previous = style;
		}
		run += suffix;
		return result + (run ? previous(run) : style(""));
	};
}
