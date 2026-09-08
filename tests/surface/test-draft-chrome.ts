import { strict as assert } from "node:assert";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { renderInputSurfaceFrame } from "../../src/surface/frame.js";
import { resolveBuiltInGlanceStyles, type TextStyler } from "../../src/theme/adapter.js";
import { stripControls } from "../../src/surface/format.js";
import { testState } from "../support/helpers.js";

function frame(width: number, icons: "plain" | "nerd", extra: Record<string, unknown> = {}) {
	const config = defaultConfig(); config.icons = icons; config.editor.topMarginRows = 0;
	return renderInputSurfaceFrame({
		state: testState(), config, width, styles: resolveBuiltInGlanceStyles("dark"),
		body: { kind: "preview" }, chrome: { hasDraft: true, ...extra },
	}).map(stripControls);
}

test("draft and workspace labels share the left connector and padding; border hints use lowercase", () => {
	const lines = frame(100, "plain");
	for (const line of lines) assert.ok(visibleWidth(line) <= 100);
	assert.match(lines[0]!, /^╭─ /);
	assert.match(lines.at(-1)!, /^╰─ draft · alt\+s ─+╯$/);
});

test("Nerd mode uses an inbox glyph; narrow frames keep its padding and prefer the scroll cue", () => {
	assert.match(frame(100, "nerd").at(-1)!, /^╰─  · alt\+s ─+╯$/);
	assert.match(frame(12, "nerd").at(-1)!, /^╰─  ─+╯$/);
	assert.match(frame(12, "plain").at(-1)!, /^╰─ draft ─+╯$/);
	assert.doesNotMatch(frame(100, "nerd").at(-1)!, /draft/);
	assert.match(frame(100, "plain", { bottomScrollIndicator: "─── ↓ 4 more " }).at(-1)!, /^╰─── ↓ 4 more /);
	assert.doesNotMatch(frame(100, "plain", { hasDraft: false }).at(-1)!, /draft/);
	for (const icons of ["plain", "nerd"] as const) for (let width = 0; width <= 120; width++) {
		for (const line of frame(width, icons)) assert.ok(visibleWidth(line) <= width);
	}
});

test("a long draft hint does not create a dark pause in the full-border sweep", () => {
	const config = defaultConfig(); config.icons = "plain"; config.editor.topMarginRows = 0;
	config.editor.stashShortcut = "ctrl+shift+alt+super+pageDown";
	const styles = resolveBuiltInGlanceStyles("dark");
	let lit = false;
	const observed = { ...styles, highlight: (style: TextStyler, amount: number) => amount > 0.01
		? (text: string) => { if (/\S/.test(text)) lit = true; return style(text); }
		: style };
	for (let elapsed = 0; elapsed < 8000; elapsed += 33) {
		lit = false;
		const lines = renderInputSurfaceFrame({ state: testState(), config, width: 80, styles: observed,
			body: { kind: "editor", lines: [""] }, chrome: { hasDraft: true, workingElapsedMs: elapsed } });
		assert.ok(lit, `visible beam at ${elapsed}ms`);
		assert.ok(lines.at(-1)!.includes(styles.title(" draft · ctrl+shift+alt+super+pagedown ")));
	}
});
