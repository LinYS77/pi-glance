import { sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { ResolvedGlanceStyles } from "../theme/adapter.js";

export const EXTENSION_STATUS_RESET = "\x1b[0m\x1b]8;;\x1b\\";

const INLINE_STYLE = /(\x1b\[[0-9;:]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\))/g;

function inlineText(value: string): string {
	// Keep only SGR and hyperlinks; cursor/screen/clipboard commands are not text.
	return value.replace(/[\r\n\t]/g, " ").split(INLINE_STYLE)
		.map((part, index) => index % 2 ? part : stripTerminalSequences(part).replace(/[\x00-\x1f\x7f-\x9f]/g, ""))
		.join("");
}

/** Copy Pi-owned values; never retain or mutate its live Map. */
export function extensionStatusEntries(statuses?: ReadonlyMap<string, string>): Array<{ key: string; text: string }> {
	const entries: Array<{ key: string; text: string }> = [];
	for (const [key, value] of [...(statuses ?? [])].sort(([a], [b]) => a.localeCompare(b))) {
		const line = inlineText(value);
		const plain = stripTerminalSequences(line), trimmed = plain.trim();
		const width = visibleWidth(trimmed);
		if (width === 0) continue;
		const start = visibleWidth(plain) - visibleWidth(plain.trimStart());
		entries.push({ key: stripTerminalSequences(inlineText(key)).trim(), text: sliceByColumn(line, start, width, true) });
	}
	return entries;
}

export function extensionStatusTexts(statuses?: ReadonlyMap<string, string>): string[] {
	return extensionStatusEntries(statuses).map(entry => entry.text);
}

/** Prefer complete leading entries; only clip when the first entry alone is too long. */
export function fitExtensionStatuses(texts: readonly string[], width: number, styles: ResolvedGlanceStyles): string | undefined {
	if (width < 4 || texts.length === 0) return undefined;
	const separator = styles.separator(" · "), ellipsis = styles.dim("…");
	const parts = texts.map(text => `${styles.text(text)}${EXTENSION_STATUS_RESET}`);
	const widths = parts.map(visibleWidth), gap = visibleWidth(separator);
	if (widths.reduce((sum, value) => sum + value, 0) + gap * (parts.length - 1) <= width) return parts.join(separator);
	let count = 0, used = 0;
	const suffixWidth = gap + visibleWidth(ellipsis);
	while (count < parts.length - 1) {
		const nextWidth = used + (count ? gap : 0) + widths[count]!;
		if (nextWidth + suffixWidth > width) break;
		used = nextWidth;
		count++;
	}
	if (count) return parts.slice(0, count).join(separator) + separator + ellipsis + EXTENSION_STATUS_RESET;
	return truncateToWidth(parts[0]!, width - visibleWidth(ellipsis), "") + EXTENSION_STATUS_RESET + ellipsis + EXTENSION_STATUS_RESET;
}
