import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { getSettingsRows } from "../../src/settings/catalog.js";
import { createPaneModel, createPaneViewModel, updatePaneModel } from "../../src/settings/model.js";
import { showGlancePane } from "../../src/settings/pane.js";
import type { ScheduleSweepFrame } from "../../src/runtime/working-sweep.js";
import { testState } from "../support/helpers.js";
import { stripAnsi } from "../support/surface-test-harness.js";

const right = "\x1b[C", down = "\x1b[B", left = "\x1b[D", up = "\x1b[A";

function makePane() {
	let now = 0, renders = 0;
	let component: (Component & { dispose?(): void }) | undefined;
	let cancel = () => {};
	let last: (() => void) | undefined;
	const tasks = new Set<() => void>();
	const schedule: ScheduleSweepFrame = (callback, delay) => {
		assert.ok(delay >= 33 && delay <= 34);
		tasks.add(callback); last = callback;
		return () => { tasks.delete(callback); };
	};
	const config = defaultConfig();
	const result = showGlancePane(config, { ui: {
		custom: <T>(factory: (tui: TUI, theme: Theme, keys: KeybindingsManager, done: (result: T) => void) => Component) => new Promise<T>((resolve) => {
			const finish = (value: T) => { component?.dispose?.(); resolve(value); };
			component = factory(
				{ terminal: { rows: 40 }, requestRender: () => { renders++; } } as unknown as TUI,
				{ fg: (_tone: string, text: string) => text } as unknown as Theme,
				undefined as unknown as KeybindingsManager,
				finish,
			);
			cancel = () => finish({ action: "cancel" } as T);
		}),
	} }, testState(), { previewNowMs: () => now, schedulePreviewFrame: schedule });
	assert.ok(component);
	const pane = component;
	return {
		pane, result, config, cancel,
		pending: () => tasks.size,
		renders: () => renders,
		stale: () => last!,
		advance(ms: number) { now += ms; for (const task of [...tasks]) { tasks.delete(task); task(); } },
		selectWorking() {
			pane.handleInput?.(right);
			const index = getSettingsRows(config, "general").findIndex(row => row.id === "general.workingSweep");
			assert.ok(index >= 0);
			for (let i = 0; i < index; i++) pane.handleInput?.(down);
		},
	};
}

test("Working setting is enabled by default and its row changes only the editor option", () => {
	const config = defaultConfig();
	const row = getSettingsRows(config, "general").find(row => row.id === "general.workingSweep")!;
	assert.equal(row.value, "on");
	assert.equal(row.kind, "toggle");
	const next = row.apply!(config);
	assert.equal(next.editor.workingSweep, false);
	assert.deepEqual({ ...next, editor: config.editor }, config);
	assert.equal(config.editor.workingSweep, true);
	const restored = getSettingsRows(next, "general").find(row => row.id === "general.workingSweep")!.apply!(next);
	assert.deepEqual(restored, config);
});

test("pane view model limits animation to the focused Working setting", () => {
	const config = defaultConfig();
	let model = createPaneModel(config);
	assert.equal(createPaneViewModel(model, 120).preview.working, false);
	model = updatePaneModel(model, { type: "move", direction: "right" }).model;
	const index = getSettingsRows(config, "general").findIndex(row => row.id === "general.workingSweep");
	model = updatePaneModel(model, { type: "move", direction: "down", amount: index }).model;
	assert.equal(createPaneViewModel(model, 120).preview.working, true);
	model = updatePaneModel(model, { type: "move", direction: "left" }).model;
	assert.equal(createPaneViewModel(model, 120).preview.working, false);
});

test("settings preview animates only while selected, stops on off, and saves the choice", async () => {
	const test = makePane();
	assert.equal(test.pending(), 0);
	assert.match(test.pane.render(120).map(stripAnsi).join("\n"), /Working animation\s+on/);
	test.selectWorking();
	assert.equal(test.pending(), 1);
	const first = test.pane.render(120);
	test.advance(800);
	const next = test.pane.render(120);
	assert.deepEqual(first.map(stripAnsi), next.map(stripAnsi));
	assert.notDeepEqual(first, next);
	const stale = test.stale();
	test.pane.handleInput?.(right); // value focus
	test.pane.handleInput?.("\r"); // off
	assert.equal(test.pending(), 0);
	const stopped = test.pane.render(120);
	test.advance(1000); stale();
	assert.deepEqual(test.pane.render(120), stopped);
	assert.match(stopped.map(stripAnsi).join("\n"), /Working animation\s+.*off/);
	assert.equal(test.config.editor.workingSweep, true, "preview never mutates the initial config");
	test.pane.handleInput?.("s");
	const saved = await test.result;
	assert.equal(saved.action, "save");
	if (saved.action === "save") assert.equal(saved.config.editor.workingSweep, false);
	assert.equal(test.pending(), 0);
});

test("leaving the Working row or closing the panel disposes its preview clock", async () => {
	const test = makePane();
	test.selectWorking();
	assert.equal(test.pending(), 1);
	test.pane.handleInput?.(up);
	assert.equal(test.pending(), 0);
	test.pane.handleInput?.(down);
	assert.equal(test.pending(), 1);
	const stale = test.stale();
	test.cancel();
	assert.deepEqual(await test.result, { action: "cancel" });
	const renders = test.renders();
	stale(); test.advance(1000);
	assert.equal(test.renders(), renders);
	assert.equal(test.pending(), 0);
	test.pane.handleInput?.(left);
	assert.equal(test.renders(), renders, "disposed panes ignore further input");
});
