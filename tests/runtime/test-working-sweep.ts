import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WorkingSweep, type ScheduleSweepFrame } from "../../src/runtime/working-sweep.js";
import { defaultConfig } from "../../src/config/model.js";
import type { GlanceEditor } from "../../src/surface/editor.js";
import { createGitHarness, createRuntimeHarness, createRuntimeTestContext, disabledConfig, invokeEditorFactory } from "../support/runtime-harness.js";
import { stripAnsi } from "../support/surface-test-harness.js";

function clock() {
	let now = 0;
	let last: (() => void) | undefined;
	const callbacks = new Set<() => void>();
	const schedule: ScheduleSweepFrame = (callback, delay) => {
		assert.ok(delay >= 33 && delay <= 34, "animation requests approximately 30 FPS");
		last = callback;
		callbacks.add(callback);
		return () => { callbacks.delete(callback); };
	};
	return { now: () => now, schedule, pending: () => callbacks.size, stale: () => last!, advance(ms: number) {
		now += ms;
		for (const cb of [...callbacks]) { callbacks.delete(cb); cb(); }
	} };
}

test("clock starts only for an active run; pauses, cancels and disposes without stale ticks", () => {
	const time = clock();
	const visibility: boolean[] = [];
	let renders = 0;
	const sweep = new WorkingSweep({ nowMs: time.now, schedule: time.schedule, ownsEditor: () => true, requestRender: () => { renders++; }, setWorkingVisible: value => { visibility.push(value); } });
	sweep.attach(); sweep.attach();
	assert.deepEqual(visibility, [false]);
	assert.equal(time.pending(), 0);
	sweep.start(); time.advance(600); sweep.start();
	assert.equal(sweep.elapsedMs(), 600, "continuations do not restart the beam");
	assert.equal(time.pending(), 1);
	const stale = time.stale();
	sweep.setWaiting(true);
	const paused = renders;
	stale(); time.advance(5000);
	assert.equal(renders, paused);
	assert.equal(sweep.elapsedMs(), undefined);
	assert.equal(time.pending(), 0);
	sweep.setWaiting(false);
	assert.equal(sweep.elapsedMs(), 0);
	sweep.settle();
	assert.equal(sweep.elapsedMs(), undefined);
	assert.equal(time.pending(), 0);
	assert.deepEqual(visibility, [false], "no native loader writes at retry/settled boundaries");
	sweep.dispose(); sweep.dispose();
	stale();
	assert.deepEqual(visibility, [false, true]);
	assert.equal(time.pending(), 0);
});

test("a delayed event loop advances the position once instead of replaying missed frames", () => {
	const time = clock();
	let renders = 0;
	const sweep = new WorkingSweep({ nowMs: time.now, schedule: time.schedule, ownsEditor: () => true,
		requestRender: () => { renders++; }, setWorkingVisible: () => {} });
	sweep.attach(true);
	assert.equal(renders, 1);
	time.advance(2000);
	assert.equal(sweep.elapsedMs(), 2000);
	assert.equal(renders, 2, "one fresh frame, not sixty catch-up renders");
	assert.equal(time.pending(), 1);
	sweep.settle();
	assert.equal(time.pending(), 0);
	sweep.dispose();
});

test("losing the editor returns native Working; reentrant settlement cannot re-arm a timer", () => {
	for (const lose of [true, false]) {
		const time = clock();
		let owned = true, settle = false;
		const visibility: boolean[] = [];
		const sweep = new WorkingSweep({ nowMs: time.now, schedule: time.schedule, ownsEditor: () => owned,
			requestRender: () => { if (settle) sweep.settle(); }, setWorkingVisible: value => { visibility.push(value); } });
		sweep.attach(true);
		if (lose) owned = false; else settle = true;
		time.advance(80);
		assert.equal(time.pending(), 0);
		assert.equal(sweep.elapsedMs(), undefined);
		sweep.dispose();
		assert.deepEqual(visibility, [false, true]);
	}
});

test("default-on runtime keeps animation separate from usage, Git and the model-speed clock", async () => {
	const time = clock(), git = createGitHarness(), ctx = createRuntimeTestContext();
	const config = defaultConfig(); config.editor.topMarginRows = 0;
	const harness = createRuntimeHarness({ workingSweepNowMs: time.now, nowMs: () => { throw new Error("animation read the model-speed clock"); }, scheduleSweepFrame: time.schedule, git, loadConfigSyncConfig: config });
	const { events } = harness.runtime;
	events.sessionStart({}, ctx.ctx);
	const editor = invokeEditorFactory(ctx, 0, () => {}) as GlanceEditor;
	editor.focused = true;
	editor.setText("input remains unchanged");
	const idle = editor.render(180);
	const reads = ctx.getEntryReads(), schedules = [...git.schedules];
	ctx.setIdle(false);
	events.agentStart({}, ctx.ctx);
	time.advance(1600);
	const active = editor.render(180);
	assert.notEqual(active[0], idle[0]);
	assert.deepEqual(active.map(stripAnsi), idle.map(stripAnsi));
	assert.deepEqual(active.slice(1), idle.slice(1));
	assert.equal(ctx.getEntryReads(), reads);
	assert.deepEqual(git.schedules, schedules);
	await events.agentEnd({ messages: [] }, ctx.ctx);
	assert.equal(time.pending(), 1);
	events.uiPromptStart({ reason: "ui_prompt", kind: "confirm" }, ctx.ctx);
	assert.deepEqual(editor.render(180), idle);
	assert.equal(time.pending(), 0);
	events.uiPromptEnd({ reason: "ui_prompt", kind: "confirm" }, ctx.ctx);
	assert.equal(time.pending(), 1);
	events.agentSettled({}, ctx.ctx);
	assert.equal(time.pending(), 1, "an earlier handler may have started another run");
	ctx.setIdle(true);
	events.agentSettled({}, ctx.ctx);
	assert.equal(time.pending(), 0);
	assert.deepEqual(editor.render(180), idle);
	await events.sessionShutdown({}, ctx.ctx);
	assert.deepEqual(ctx.workingVisibility, [false, true]);
});

test("disable, re-enable and reload keep just one clock and restore the native row", async () => {
	const time = clock(), ctx = createRuntimeTestContext({ idle: false });
	const config = defaultConfig();
	const harness = createRuntimeHarness({ workingSweepNowMs: time.now, scheduleSweepFrame: time.schedule, git: createGitHarness(), showPaneResults: [{ action: "save", config: disabledConfig(config) }, { action: "save", config }] });
	const { events, commands } = harness.runtime;
	events.sessionStart({}, ctx.ctx);
	assert.equal(time.pending(), 1);
	const stale = time.stale();
	await commands.openPane("", ctx.ctx);
	assert.equal(time.pending(), 0);
	await commands.openPane("", ctx.ctx);
	assert.equal(time.pending(), 1);
	stale();
	assert.equal(time.pending(), 1);
	events.sessionStart({}, ctx.ctx);
	assert.equal(time.pending(), 1);
	await events.sessionShutdown({}, ctx.ctx);
	assert.equal(time.pending(), 0);
	assert.deepEqual(ctx.workingVisibility, [false, true, false, true, false, true]);
});

test("saving the Working setting toggles in place and respects an already-open prompt", async () => {
	const time = clock(), ctx = createRuntimeTestContext({ idle: false });
	const config = defaultConfig(); config.editor.topMarginRows = 0;
	const off = structuredClone(config); off.editor.workingSweep = false;
	const harness = createRuntimeHarness({ workingSweepNowMs: time.now, scheduleSweepFrame: time.schedule, git: createGitHarness(), loadConfigSyncConfig: config,
		showPaneResults: [{ action: "save", config: off }, { action: "save", config }, { action: "cancel" }] });
	const { events, commands } = harness.runtime;
	events.sessionStart({}, ctx.ctx);
	const factory = ctx.getCurrentEditorFactory();
	const editor = invokeEditorFactory(ctx, 0, () => {}) as GlanceEditor;
	editor.focused = true; editor.setText("Keep my draft 中文🙂");
	time.advance(800);
	assert.equal(time.pending(), 1);
	events.uiPromptStart({ reason: "ui_prompt", kind: "custom" }, ctx.ctx);
	await commands.openPane("", ctx.ctx);
	events.uiPromptEnd({ reason: "ui_prompt", kind: "custom" }, ctx.ctx);
	assert.equal(time.pending(), 0);
	const staticFrame = editor.render(180);
	assert.deepEqual(ctx.workingVisibility, [false, true]);

	// Enable while the UI span is still open: no clock until ui_prompt_end.
	events.uiPromptStart({ reason: "ui_prompt", kind: "custom" }, ctx.ctx);
	await commands.openPane("", ctx.ctx);
	assert.equal(time.pending(), 0);
	assert.deepEqual(editor.render(180), staticFrame);
	events.uiPromptEnd({ reason: "ui_prompt", kind: "custom" }, ctx.ctx);
	assert.equal(time.pending(), 1);
	time.advance(800);
	assert.notEqual(editor.render(180)[0], staticFrame[0]);
	assert.equal(editor.getText(), "Keep my draft 中文🙂");
	assert.equal(ctx.getCurrentEditorFactory(), factory);
	assert.equal(ctx.editorFactories.length, 1);
	assert.equal(ctx.footerFactories.length, 1);

	const visibility = [...ctx.workingVisibility];
	await commands.openPane("", ctx.ctx);
	assert.deepEqual(ctx.workingVisibility, visibility, "cancel does not apply a draft setting");
	assert.equal(time.pending(), 1);
	await events.sessionShutdown({}, ctx.ctx);
	assert.equal(time.pending(), 0);
});

for (const failure of ["write-error", "read-only"] as const) {
	test(`failed Working setting save preserves the running configuration: ${failure}`, async () => {
		const time = clock(), ctx = createRuntimeTestContext({ idle: false });
		const config = defaultConfig(), off = structuredClone(config); off.editor.workingSweep = false;
		const harness = createRuntimeHarness({ workingSweepNowMs: time.now, scheduleSweepFrame: time.schedule, git: createGitHarness(),
			loadConfigSyncResult: { config, status: failure === "read-only" ? "future" : "loaded", writable: failure !== "read-only" },
			saveConfigError: failure === "write-error" ? new Error("test write failure") : undefined,
			showPaneResults: [{ action: "save", config: off }] });
		harness.runtime.events.sessionStart({}, ctx.ctx);
		await harness.runtime.commands.openPane("", ctx.ctx);
		assert.equal(time.pending(), 1);
		assert.deepEqual(ctx.workingVisibility, [false]);
		assert.equal(harness.savedConfigs.length, 0);
		await harness.runtime.events.sessionShutdown({}, ctx.ctx);
	});
}

for (const options of [{ workingSweep: false }, { mode: "rpc" }, { mode: "json" }, { mode: "print" }, { disabled: true }] as const) {
	test(`native behavior remains untouched: ${JSON.stringify(options)}`, async () => {
		const time = clock();
		const ctx = createRuntimeTestContext({ mode: "mode" in options ? options.mode : "tui", idle: false });
		const config = "disabled" in options ? disabledConfig() : defaultConfig();
		if ("workingSweep" in options) config.editor.workingSweep = false;
		const harness = createRuntimeHarness({ workingSweepNowMs: time.now, scheduleSweepFrame: time.schedule, git: createGitHarness(), loadConfigSyncConfig: config });
		harness.runtime.events.sessionStart({}, ctx.ctx);
		harness.runtime.events.agentStart({}, ctx.ctx);
		assert.equal(time.pending(), 0);
		assert.deepEqual(ctx.workingVisibility, []);
		await harness.runtime.events.sessionShutdown({}, ctx.ctx);
	});
}
