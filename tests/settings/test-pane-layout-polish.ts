import { strict as assert } from "node:assert";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { paneHarness, keys as k } from "../support/pane-harness.js";

test("short terminals use a compact navigable list and explain the hidden preview", () => {
	const h = paneHarness();
	try {
		h.height(12); h.press(k.tab, k.tab, k.down, k.down);
		const lines = h.pane.render(40);
		assert.ok(lines.length > 2 && lines.length <= 10, "use the available rows instead of dropping to an emergency two-line view");
		assert.match(h.text(40), /Preview hidden/);
		assert.match(h.text(40), /› Sweep speed/);
		assert.match(h.text(40), /\[Esc\]/);
		for (const height of [1, 2, 4, 6, 10, 12, 16, 24, 40]) for (const width of [0, 1, 16, 32, 40, 64, 80, 180]) {
			h.height(height);
			const rendered = h.pane.render(width);
			assert.ok(rendered.length <= Math.max(1, height - 2));
			assert.ok(rendered.every(line => visibleWidth(line) <= width));
		}
	} finally { h.pane.dispose(); }
});
