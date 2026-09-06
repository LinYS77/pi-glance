import { visibleWidth } from "@earendil-works/pi-tui";
import type { SegmentData, SegmentDefinition, SegmentRenderContext, SegmentRenderResult } from "../types.js";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function middleEllipsis(text: string, width: number): string | undefined {
	if (visibleWidth(text) <= width) return text;
	// Less than three columns at each end rarely identifies a model usefully.
	if (width < 7) return undefined;
	const parts = Array.from(graphemes.segment(text), ({ segment }) => ({ text: segment, width: visibleWidth(segment) }));
	const headBudget = Math.ceil((width - 1) / 2);
	let head = "", tail = "", headWidth = 0, tailWidth = 0, first = 0;
	while (first < parts.length && headWidth + parts[first]!.width <= headBudget) {
		head += parts[first]!.text;
		headWidth += parts[first++]!.width;
	}
	for (let last = parts.length - 1; last >= first && tailWidth + parts[last]!.width <= width - 1 - headWidth; last--) {
		tail = parts[last]!.text + tail;
		tailWidth += parts[last]!.width;
	}
	return head && tail ? `${head}…${tail}` : undefined;
}

function fitCollectedSegment(fit: NonNullable<SegmentData["fit"]>, iconPrefix: string, width: number): string | undefined {
	for (const alternative of fit.alternatives) {
		const text = `${iconPrefix}${alternative}`.trim();
		if (visibleWidth(text) <= width) return text;
	}
	const prefix = `${iconPrefix}${fit.name.prefix}`;
	const name = middleEllipsis(fit.name.value, width - visibleWidth(prefix) - visibleWidth(fit.name.suffix));
	return name === undefined ? undefined : `${prefix}${name}${fit.name.suffix}`.trim();
}

function displayForMode(data: SegmentData, widthMode: SegmentRenderContext["widthMode"]): string {
	if (widthMode === "minimal" && data.display?.minimal !== undefined) return data.display.minimal;
	if (widthMode === "compact" && data.display?.compact !== undefined) return data.display.compact;
	if (widthMode === "full" && data.display?.full !== undefined) return data.display.full;
	const secondary = data.secondary ? ` ${data.secondary}` : "";
	return `${data.primary}${secondary}`.trim();
}

function iconGapForSegment(ctx: SegmentRenderContext, segment: SegmentDefinition): string {
	return " ".repeat(segment.iconSpacing?.[ctx.config.icons] ?? 1);
}

function renderCollectedSegment(ctx: SegmentRenderContext, segment: SegmentDefinition, data: SegmentData): SegmentRenderResult {
	const icon = ctx.icons[segment.id];
	const value = displayForMode(data, ctx.widthMode);
	const prefix = icon ? `${icon}${iconGapForSegment(ctx, segment)}` : "";
	const fit = data.fit;
	const text = `${prefix}${value}`.trim();
	return {
		id: segment.id,
		tone: data.tone ?? "normal",
		text,
		...(fit ? { fit: (width: number) => fitCollectedSegment(fit, prefix, width) } : {}),
	};
}

export function renderSegment(ctx: SegmentRenderContext, segment: SegmentDefinition): SegmentRenderResult | undefined {
	const data = segment.collect(ctx);
	return data ? renderCollectedSegment(ctx, segment, data) : undefined;
}
