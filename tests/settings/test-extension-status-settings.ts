import { strict as assert } from "node:assert";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { keys, paneHarness } from "../support/pane-harness.js";

test("the Extensions overview row aligns with other status rows and preserves its live preview", () => {
	const config = defaultConfig();
	config.segments = config.segments.map(s => ({ ...s, enabled: ["extensions", "model"].includes(s.id) }));
	const statuses = new Map([["a", "MCP OK"]]);
	const h = paneHarness(config, { getExtensionStatuses: () => statuses });
	try {
		h.press(keys.tab, ...Array(5).fill(keys.down));
		const rows = h.text().split("\n");
		const row = rows.find(line => line.includes("Extensions") && line.includes("On"));
		const modelRow = rows.find(line => /Model\s+On/.test(line));
		assert.ok(row && row.endsWith("On  ›"), row);
		assert.equal(row.indexOf("On"), modelRow?.indexOf("On"));
		assert.ok(h.text().includes("MCP OK"));
		statuses.set("a", "MCP DOWN"); assert.ok(h.text().includes("MCP DOWN"));
		h.press(keys.space); assert.equal(h.text().includes("MCP DOWN"), false);
		h.press(keys.space); assert.ok(h.text().includes("MCP DOWN"));
		h.press("j", "s");
		const result = h.completion(); assert.ok(result?.action === "save");
		assert.equal(result.config.segments.at(-1)!.id, "extensions", "Extensions reorders like other status items");
		assert.equal(result.config.segments.at(-1)!.enabled, true);
		assert.equal(config.segments[5]!.id, "extensions", "editing the draft leaves the caller config unchanged");
	} finally { h.pane.dispose(); }
});

test("Extensions details show live publisher keys and text, including when the group is disabled", () => {
	const config = defaultConfig();
	config.segments.find(s => s.id === "extensions")!.enabled = false;
	const statuses = new Map([["pi-quotas-usage", "DEMO 5h 80% left"], ["worker", "Working"]]);
	const h = paneHarness(config, { getExtensionStatuses: () => statuses });
	try {
		h.press(keys.tab, ...Array(5).fill(keys.down), keys.enter);
		assert.ok(h.text().includes("Status line / Extensions (Off)"));
		assert.ok(h.text().includes("pi-quotas-usage"));
		assert.ok(h.text().includes("DEMO 5h 80% left"));
		assert.ok(!h.text().includes("[Enter] Edit") && !h.text().includes("[Space] Toggle"));
		statuses.set("pi-quotas-usage", "DEMO 5h 10% left");
		assert.ok(h.text().includes("DEMO 5h 10% left"), "same-map updates must also reach open details");
		h.press(keys.enter, keys.space, keys.right, "j");
		assert.ok(h.text().includes("No changes"), "diagnostics must not create configuration edits");
		statuses.clear(); assert.ok(h.text().includes("No extension statuses published."));
		h.press(keys.esc); assert.ok(h.text().includes("› Extensions"));
	} finally { h.pane.dispose(); }
});

test("extension diagnostics scroll, remember their place, clamp when publishers disappear, and fit tiny terminals", () => {
	const statuses = new Map(Array.from({ length: 25 }, (_, i) => [`provider-${String(i).padStart(2, "0")}`, `DEMO ${i} 中文🙂`]));
	const h = paneHarness(defaultConfig(), { getExtensionStatuses: () => statuses });
	try {
		h.height(16);
		h.press(keys.tab, ...Array(5).fill(keys.down), keys.enter);
		assert.ok(!h.text(68).includes("provider-24"));
		h.press(...Array(24).fill(keys.down));
		assert.ok(h.text(68).includes("provider-24"));
		h.press(keys.tab, keys.backTab);
		assert.ok(h.text(68).includes("provider-24"));
		statuses.clear(); statuses.set("first", "DEMO 10% left"); statuses.set("second", "DEMO 20% left");
		assert.ok(h.text(68).includes("› second:"));
		h.press(keys.up);
		assert.ok(h.text(68).includes("› first:"), "the first Up after shrink must move from the visible selection, not a stale index");
		for (const width of [1, 8, 40, 68, 100]) for (const height of [1, 4, 16, 40]) {
			h.height(height);
			const lines = h.pane.render(width);
			assert.ok(lines.length <= Math.max(1, height - 2));
			for (const line of lines) assert.ok(visibleWidth(line) <= width);
		}
	} finally { h.pane.dispose(); }
});

test("diagnostics distinguish an unattached source from an attached but empty map", () => {
	for (const [source, message] of [
		[undefined, "Extension status source is not attached."],
		[new Map<string, string>(), "No extension statuses published."],
	] as const) {
		const h = paneHarness(defaultConfig(), { getExtensionStatuses: () => source });
		try {
			h.press(keys.tab, ...Array(5).fill(keys.down), keys.enter);
			assert.ok(h.text().includes(message));
		} finally { h.pane.dispose(); }
	}
});
