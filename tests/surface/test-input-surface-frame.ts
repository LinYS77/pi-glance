import { strict as assert } from "node:assert";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { renderInputSurfaceFrame } from "../../src/surface/frame.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import { richInputSurfaceState, stripAnsi } from "../support/surface-test-harness.js";

test("the shared frame preserves native body bytes, scroll labels and a caller-rendered status", () => {
	const config = defaultConfig(); config.editor.topMarginRows = 2; config.editor.minContentRows = 4;
	const styles = resolveBuiltInGlanceStyles("light");
	const body = "already-rendered \x1b[35mRAW\x1b[0m body";
	const lines = renderInputSurfaceFrame({
		state: richInputSurfaceState(), config, width: 48, styles,
		body: { kind: "editor", lines: [body] },
		chrome: { focus: "focused", topScrollIndicator: "─── ↑ 7 more ", bottomScrollIndicator: "─── ↓ 2 more " },
		status: { render: (budget, currentStyles) => {
			assert.ok(budget >= 0);
			return currentStyles.warn("custom status");
		} },
	});
	assert.equal(lines.length, 8);
	assert.deepEqual(lines.slice(0, 2), [" ", " "]);
	assert.ok(stripAnsi(lines[2]!).includes("↑ 7 more"));
	assert.ok(lines[2]!.includes(styles.warn("custom status")));
	assert.ok(lines[3]!.includes(body));
	assert.match(stripAnsi(lines[4]!), /^│ *│$/);
	assert.ok(stripAnsi(lines.at(-1)!).includes("↓ 2 more"));
	for (const line of lines) assert.ok(visibleWidth(line) <= 48);
});

test("unfocused frame removes publisher styling and controls before dimming status text", () => {
	const config = defaultConfig(); config.editor.topMarginRows = 0;
	const styles = resolveBuiltInGlanceStyles("light");
	const input = { state: richInputSurfaceState(), config, width: 64, styles,
		body: { kind: "editor" as const, lines: [""] }, status: { render: () => "\x1b[31mHOT\tNOW\x1b[0m" } };
	const focused = renderInputSurfaceFrame(input);
	const unfocused = renderInputSurfaceFrame({ ...input, chrome: { focus: "unfocused" } });
	assert.ok(focused[0]!.includes("\x1b[31mHOT\tNOW\x1b[0m"));
	assert.ok(unfocused[0]!.includes(styles.dim("HOT NOW")));
	assert.ok(unfocused[0]!.startsWith(styles.dim("╭")));
});
