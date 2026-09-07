import { strict as assert } from "node:assert";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { planSurfaceRow } from "../../src/surface/layout.js";
import { formatWorkspaceLabel } from "../../src/surface/format.js";

for (const grapheme of ["👨‍👩‍👧‍👦", "🇨🇳", "👍🏽", "e\u0301", "क्‍ष"]) {
	test(`clipping preserves whole graphemes: ${grapheme}`, () => {
		const name = grapheme.repeat(12);
		const boundaries = new Set([0, ...Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name), ({ segment, index }) => index + segment.length)]);
		for (let width = 1; width <= 16; width++) {
			for (const value of [
				planSurfaceRow({ width: width + 2, text: name }).content,
				formatWorkspaceLabel(`/projects/${name}`, name, "name", width),
			]) {
				assert.ok(visibleWidth(value) <= width);
				const prefix = value.endsWith("…") ? value.slice(0, -1) : value;
				assert.ok(boundaries.has(prefix.length), `width ${width}: ${JSON.stringify(value)}`);
			}
		}
	});
}
