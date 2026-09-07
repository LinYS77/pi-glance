import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cloneConfig, defaultConfig } from "../../src/config/model.js";
import { GlanceLineRenderer, renderGlanceLine } from "../../src/surface/status-line.js";
import { createInputSurfaceRenderer, renderInputSurface } from "../../src/surface/renderer.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import { richInputSurfaceState } from "../support/surface-test-harness.js";

test("status cache skips collection until a render input changes", () => {
	let reads = 0;
	const sample = richInputSurfaceState();
	let state = { ...sample, get usage() { reads++; return sample.usage; } };
	let config = defaultConfig();
	let width = 160;
	let styles = resolveBuiltInGlanceStyles("light");
	let widthMode: "full" | "minimal" = "full";
	const renderer = new GlanceLineRenderer();
	const render = () => renderer.render(state, config, width, state.providers.availableCount, { styles, widthMode });
	const check = () => {
		const before = reads;
		const actual = render();
		assert.ok(reads > before, "changed inputs must refresh the status");
		const cached = reads;
		for (let i = 0; i < 30; i++) assert.equal(render(), actual);
		assert.equal(reads, cached, "unchanged frames do not recollect facts");
		assert.equal(actual, renderGlanceLine(state, config, width, state.providers.availableCount, { styles, widthMode }));
	};
	check();
	state.version++; check();
	state = { ...state, get usage() { reads++; return sample.usage; } }; check();
	config = cloneConfig(config); config.icons = "plain"; check();
	width = 80; check();
	styles = resolveBuiltInGlanceStyles("dark"); check();
	styles = resolveBuiltInGlanceStyles("dark", "ansi256"); check();
	state.providers.availableCount++; check();
	widthMode = "minimal"; check();
});

test("preview reuses status facts, not the animated frame or prompt contents", () => {
	let reads = 0;
	const sample = richInputSurfaceState();
	const state = { ...sample, get usage() { reads++; return sample.usage; } };
	const render = createInputSurfaceRenderer(state);
	const config = defaultConfig();
	const first = render(config, 100, { workingElapsedMs: 0 });
	const baseline = reads;
	const next = render(config, 100, { workingElapsedMs: 900, contentLines: ["a different prompt"] });
	assert.equal(reads, baseline);
	assert.notDeepEqual(next, first);
	assert.ok(next.join("").includes("a different prompt"));
	assert.deepEqual(next, renderInputSurface(state, config, 100, { workingElapsedMs: 900, contentLines: ["a different prompt"] }));
	state.context.percent = 92; state.version++;
	assert.deepEqual(render(config, 100, { previewDensity: "full", trueColor: false }), renderInputSurface(state, config, 100, { previewDensity: "full", trueColor: false }));
});
