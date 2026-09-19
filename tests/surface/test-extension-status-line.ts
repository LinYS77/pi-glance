import { strict as assert } from "node:assert";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import { GlanceLineRenderer, renderGlanceLine } from "../../src/surface/status-line.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import { testState } from "../support/helpers.js";

test("standard extension statuses are value-only facts between Tokens and Model", () => {
	const config = defaultConfig(); config.icons = "plain";
	config.segments = config.segments.filter(s => ["tokens", "extensions", "model"].includes(s.id));
	const state = testState({ model: { id: "test-model", displayName: "test-model", thinking: "off" }, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } });
	const options = { widthMode: "full" as const, extensionStatuses: new Map([["z", "PLAN"], ["a", "MCP: 3/3"]]) };
	const text = stripTerminalSequences(renderGlanceLine(state, config, 180, 1, options));
	assert.equal(text, "tok ↑0 ↓0 · MCP: 3/3 · PLAN · ai test-model");
});

test("external status length cannot shorten or evict the built-in facts that fit without it", () => {
	const config = defaultConfig(); config.icons = "plain";
	const state = testState();
	const extensionStatuses = new Map([["a", "MCP: " + "long status ".repeat(40)], ["b", "PLAN"]]);
	for (const width of [0, 1, 4, 8, 12, 20, 40, 64, 80, 120, 180, 240]) {
		const baseline = stripTerminalSequences(renderGlanceLine(state, config, width));
		const raw = renderGlanceLine(state, config, width, 1, { extensionStatuses });
		const line = stripTerminalSequences(raw);
		for (const fact of baseline.split(" · ").filter(Boolean)) assert.ok(line.includes(fact), `${width}: lost ${fact}: ${line}`);
		assert.ok(visibleWidth(raw) <= width);
	}
	const line = stripTerminalSequences(renderGlanceLine(state, config, 240, 1, { extensionStatuses }));
	assert.ok(line.includes("MCP:") && line.includes("…"), line);
});

test("the cached line observes in-place status text, ANSI, deletion and visibility changes", () => {
	let config = defaultConfig();
	const state = testState(), renderer = new GlanceLineRenderer();
	const extensionStatuses = new Map([["worker", "Ready"]]);
	const render = () => renderer.render(state, config, 240, 1, { extensionStatuses });
	assert.ok(render().includes("Ready"));
	const version = state.version;
	extensionStatuses.set("worker", "Updated");
	assert.ok(render().includes("Updated"));
	extensionStatuses.set("worker", "\x1b[31mUpdated\x1b[0m");
	assert.ok(render().includes("\x1b[31mUpdated"));
	config = { ...config, segments: config.segments.map(s => s.id === "extensions" ? { ...s, enabled: false } : s) };
	assert.equal(render().includes("Updated"), false);
	extensionStatuses.set("worker", "Hidden change");
	config = { ...config, segments: config.segments.map(s => ({ ...s, enabled: true })) };
	assert.ok(render().includes("Hidden change"));
	extensionStatuses.delete("worker");
	assert.equal(render().includes("Hidden change"), false);
	extensionStatuses.set("worker", "Again"); render(); extensionStatuses.clear();
	assert.equal(render().includes("Again"), false);
	assert.equal(state.version, version);
});

test("single-line normalization ignores empty statuses and preserves Unicode, ANSI and style boundaries", () => {
	const config = defaultConfig(); config.icons = "plain";
	config.segments = [{ id: "extensions", enabled: true }, { id: "model", enabled: true }];
	const statuses = new Map([
		["empty", "\x1b[31m \t\r\n\x1b[0m"],
		["a", "\x1b[31m  中文 👩🏽‍💻 e\u0301\tready\x1b[0m  "],
		["b", "\x1b]8;;https://example.invalid\x1b\\\x1b[1mPLAN"],
	]);
	const before = [...statuses], state = testState();
	const styles = resolveBuiltInGlanceStyles("dark");
	const render = (width: number) => renderGlanceLine(state, config, width, 1, { extensionStatuses: statuses, styles });
	const full = render(240), plain = stripTerminalSequences(full);
	assert.equal(plain, "中文 👩🏽‍💻 é ready · PLAN · ai GPT 5.5");
	assert.ok(full.includes("\x1b[31m"));
	assert.ok(full.includes(styles.separator(" · ")));
	const boundary = full.slice(full.indexOf("PLAN"), full.indexOf("ai GPT"));
	assert.ok(boundary.includes("\x1b[0m"), "publisher bold must not reach Model");
	assert.ok(full.includes("https://example.invalid"), "publisher links are preserved");
	assert.ok(boundary.includes("\x1b]8;;\x1b\\"), "the publisher's hyperlink must close before Model");
	for (const width of [0, 1, 2, 3, 4, 7, 8, 12, 13, 24, 40, 80, 240]) {
		const raw = render(width);
		assert.ok(visibleWidth(raw) <= width, `${width}: ${raw}`);
		assert.equal(/[\r\n\t]/.test(raw), false);
		const text = stripTerminalSequences(raw);
		if (text.includes("👩")) assert.ok(text.includes("👩🏽‍💻"));
		assert.doesNotMatch(text, /(?:^| )e(?!\u0301)/, "the combining accent must stay attached");
	}
	assert.deepEqual([...statuses], before, "normalization and fitting never mutate the provider's map");
	for (const width of [-1, Number.NaN, Infinity]) assert.equal(render(width), "");
});

test("empty groups leave no separator and explicit ordering/visibility works without Model or Tokens", () => {
	const config = defaultConfig(); config.icons = "plain";
	const state = testState(), statuses = new Map([["z", "last"], ["a", "first"]]);
	const render = () => stripTerminalSequences(renderGlanceLine(state, config, 180, 1, { extensionStatuses: statuses }));
	config.segments = [{ id: "model", enabled: true }, { id: "extensions", enabled: true }];
	assert.equal(render(), "ai GPT 5.5 · first · last");
	config.segments[0]!.enabled = false;
	assert.equal(render(), "first · last");
	config.segments[1]!.enabled = false; assert.equal(render(), "");
	config.segments[1]!.enabled = true;
	statuses.clear(); statuses.set("a", "\x1b[31m\x1b[0m"); assert.equal(render(), "");
	config.segments[0]!.enabled = true; assert.equal(render(), "ai GPT 5.5");
});

test("overflow prefers whole leading statuses with an omission mark and caps external width", () => {
	const config = defaultConfig(); config.icons = "plain";
	config.segments = [{ id: "extensions", enabled: true }, { id: "model", enabled: true }];
	const options = { extensionStatuses: new Map([["a", "PLAN"], ["b", "MCP ready"], ["c", "x".repeat(500)]]) };
	const line = stripTerminalSequences(renderGlanceLine(testState(), config, 90, 1, options));
	assert.equal(line, "PLAN · MCP ready · … · ai GPT 5.5");
	config.segments = [{ id: "extensions", enabled: true }];
	const edge = stripTerminalSequences(renderGlanceLine(testState(), config, 4, 1, {
		extensionStatuses: new Map([["a", "PLAN"], ["b", "more"]]),
	}));
	assert.ok(edge.endsWith("…"), "hidden entries must be indicated even when the first entry exactly fits");
});

test("publisher terminal commands cannot erase the frame or move its cursor; text styling remains", () => {
	const config = defaultConfig(); config.segments = [{ id: "extensions", enabled: true }];
	const text = "\x1b[2J\x1b[H\x1b[31mready\x1b[0m\x07\x08\x1b]52;c;YQ==\x07";
	const raw = renderGlanceLine(testState(), config, 80, 1, { extensionStatuses: new Map([["x", text]]) });
	assert.equal(stripTerminalSequences(raw), "ready");
	assert.ok(raw.includes("\x1b[31m"));
	for (const control of ["\x1b[2J", "\x1b[H", "\x1b]52;", "\x07", "\x08"]) assert.equal(raw.includes(control), false);
});
