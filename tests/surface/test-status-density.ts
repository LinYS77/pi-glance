import { strict as assert } from "node:assert";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { stripControls } from "../../src/surface/format.js";
import { renderGlanceLine } from "../../src/surface/status-line.js";
import { renderInputSurface } from "../../src/surface/renderer.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import type { WidthMode } from "../../src/types.js";
import { testState } from "../support/helpers.js";

function densityState() {
	return testState({
		workspace: { name: "07_pi-glance", path: "/work/00_project/07_pi-glance" },
		git: { ...testState().git, repo: true, branch: "main", status: "dirty", dirty: true, unstaged: 1, ahead: 1 },
		providers: { availableCount: 2 },
		model: { id: "team-gpt-6-astra", displayName: "team-gpt-6-astra", provider: "TEAM", thinking: "xhigh" },
		context: { tokens: 258_400, window: 680_000, percent: 38 },
		usage: { input: 1_000_000, output: 1_700_000, cacheRead: 24_000_000, cacheWrite: 0, cost: 414.1 },
	});
}

const expected: Record<WidthMode, string[]> = {
	full: ["git main * ↑1", "$414.1", "spd ? tok/s", "ctx 38% 258k/680k", "tok ↑1.0M ↓1.7M 96%", "ai TEAM/team-gpt-6-astra xhigh"],
	compact: ["git main *", "$414.1", "spd ?/s", "ctx 38%", "tok 96%", "ai team-gpt-6-astra"],
	minimal: ["git main *", "$414.1", "spd ?/s", "ctx 38%", "tok 96%", "ai gpt-6-astra"],
};

test("all six segments share detail, primary-fact and identity density semantics even with spare space", () => {
	const config = defaultConfig();
	config.icons = "plain";
	for (const widthMode of ["full", "compact", "minimal"] as const) {
		assert.equal(
			stripControls(renderGlanceLine(densityState(), config, 220, 2, { widthMode })),
			expected[widthMode].join(" · "),
			widthMode,
		);
	}
});

test("every segment crosses the same actual status-width boundaries", () => {
	const config = defaultConfig();
	config.icons = "plain";
	for (const [width, mode] of [[96, "full"], [95, "compact"], [64, "compact"], [63, "minimal"]] as const) {
		for (const [index, segment] of config.segments.entries()) {
			const single = { ...config, segments: [segment] };
			assert.equal(stripControls(renderGlanceLine(densityState(), single, width)), expected[mode][index], `${segment.id} at ${width} columns`);
		}
	}
});

test("the reported half-screen frame folds Git and Model details alongside Context and Tokens", () => {
	const config = defaultConfig(), state = densityState();
	const half = stripControls(renderInputSurface(state, config, 120)[config.editor.topMarginRows]!);
	for (const fact of [" main ●", "$414.1", "?/s", "38%", "96%", "󰚩 team-gpt-6-astra"]) assert.ok(half.includes(fact), half);
	for (const detail of ["↑1", "xhigh", "TEAM/", "258k/680k", "1.7M"]) assert.equal(half.includes(detail), false, half);
	for (let width = 40; width <= 220; width++) {
		const raw = renderInputSurface(state, config, width)[config.editor.topMarginRows]!;
		const text = stripControls(raw);
		assert.ok(visibleWidth(raw) <= width);
		if (text.includes("?/s")) {
			assert.equal(text.includes("xhigh"), false, `Model and speed disagree at ${width}: ${text}`);
			assert.equal(text.includes("↑1"), false, `Git and speed disagree at ${width}: ${text}`);
		}
	}
});

test("density preserves alerts, explicit detail choices and model always labels", () => {
	const config = defaultConfig(), state = densityState();
	config.icons = "plain";
	config.git.showDirty = false;
	config.git.shaMode = "always";
	config.context.display = "tokens";
	config.display.showProvider = "always";
	config.model.showThinking = "always";
	state.git.status = "conflict";
	state.git.sha = "abcdef1";
	state.context.percent = 95;
	const styles = resolveBuiltInGlanceStyles("light");
	for (const widthMode of ["full", "compact", "minimal"] as const) {
		const raw = renderGlanceLine(state, config, 240, 2, { widthMode, styles });
		const text = stripControls(raw);
		assert.ok(text.includes("git main abcdef1 !"), text);
		assert.ok(text.includes("$414.1"), text);
		assert.ok(raw.includes(styles.error("ctx 258k/680k")), "density must not erase a tokens-only Context alert");
		assert.ok(text.includes(widthMode === "minimal" ? "ai TEAM/gpt-6-astra xhigh" : "ai TEAM/team-gpt-6-astra xhigh"), text);
	}
});
