import { strict as assert } from "node:assert";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { renderGlanceLine } from "../../src/surface/status-line.js";
import { stripControls } from "../../src/surface/format.js";
import { testState } from "../support/helpers.js";
import type { SegmentId } from "../../src/types.js";

test("Model is the last segment removed, independent of its display position", () => {
	const state = testState({
		model: { id: "small", displayName: "Small", thinking: "off" },
		git: { ...testState().git, repo: true, branch: "a-very-long-branch-name", status: "clean" },
		usage: { input: 1000, output: 200, cacheRead: 500, cacheWrite: 0, cost: 12 },
	});
	const others: SegmentId[] = ["git", "cost", "throughput", "context", "tokens"];
	for (let position = 0; position <= others.length; position++) {
		const order = [...others]; order.splice(position, 0, "model");
		const config = defaultConfig(); config.icons = "plain";
		config.segments = order.map(id => ({ id, enabled: true }));
		const wide = stripControls(renderGlanceLine(state, config, 240));
		assert.equal(wide.split(" · ")[position], "ai Small", "priority must not reorder the displayed segments");
		for (let width = 8; width <= 90; width++) {
			const raw = renderGlanceLine(state, config, width);
			assert.ok(stripControls(raw).includes("ai Small"), `${order} at ${width}: ${stripControls(raw)}`);
			assert.ok(visibleWidth(raw) <= width);
		}
		assert.equal(stripControls(renderGlanceLine(state, config, 8)), "ai Small");
	}
});

test("protecting Model does not enable it or reorder the remaining facts", () => {
	const config = defaultConfig(); config.icons = "plain";
	config.segments = [{ id: "cost", enabled: true }, { id: "model", enabled: false }, { id: "context", enabled: true }];
	const state = testState();
	assert.equal(stripControls(renderGlanceLine(state, config, 6)), "$0.000");
	assert.equal(stripControls(renderGlanceLine(state, config, 160)), "$0.000 · ctx 23% 47k/200k");
});
