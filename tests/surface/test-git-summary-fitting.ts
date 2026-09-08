import { strict as assert } from "node:assert";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { renderGlanceLine } from "../../src/surface/status-line.js";
import { stripControls } from "../../src/surface/format.js";
import { testState } from "../support/helpers.js";

test("Git's optional summary shrinks before it pushes another status segment out", () => {
	const config = defaultConfig();
	config.icons = "plain";
	config.git.changes = "marker";
	const state = testState();
	state.git = { ...state.git, repo: true, branch: "feature", status: "dirty", dirty: true, summary: { files: 123456, additions: 999999999, deletions: 999999999 } };
	const full = stripControls(renderGlanceLine(state, config, 300));
	const width = Math.max(96, visibleWidth(full));
	const before = stripControls(renderGlanceLine(state, config, width));
	config.git.changes = "summary";
	const after = stripControls(renderGlanceLine(state, config, width));
	assert.ok(after.endsWith(before.slice(before.indexOf(" · "))), `${before}\n${after}`);
	assert.ok(visibleWidth(after) <= width);
});
