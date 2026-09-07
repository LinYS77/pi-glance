import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Most rendered lines already fit. Avoid parsing their ANSI and graphemes twice. */
export function truncateStyledText(text: string, width: number, ellipsis = ""): string {
	const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
	if (!safeWidth) return "";
	return visibleWidth(text) <= safeWidth ? text : truncateToWidth(text, safeWidth, ellipsis);
}

/** Clip unstyled text without introducing ANSI resets or splitting a grapheme. */
export function truncatePlainText(text: string, width: number, ellipsis = "…"): string {
	const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
	if (!safeWidth) return "";
	if (visibleWidth(text) <= safeWidth) return text;
	const marker = visibleWidth(ellipsis) <= safeWidth ? ellipsis : "";
	const budget = safeWidth - visibleWidth(marker);
	let used = 0;
	let end = 0;
	for (const { segment, index } of graphemes.segment(text)) {
		const columns = visibleWidth(segment);
		if (used + columns > budget) break;
		used += columns;
		end = index + segment.length;
	}
	return text.slice(0, end) + marker;
}
