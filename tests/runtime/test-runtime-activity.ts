import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { animationTime, nativeActivity } from "../support/activity-harness.js";
import type { GlanceEditor } from "../../src/surface/editor.js";
import { createGitHarness, createRuntimeHarness, createRuntimeTestContext, invokeEditorFactory } from "../support/runtime-harness.js";

test("Text mode embeds Pi status without hiding the native source or starting a Glance animation clock", async () => {
	const ctx = createRuntimeTestContext({ idle: false });
	const h = createRuntimeHarness({ git: createGitHarness(), scheduleSweepFrame: () => { throw new Error("Text started an animation"); } });
	h.runtime.events.sessionStart({}, ctx.ctx);
	const editor = invokeEditorFactory(ctx, 0, () => {}) as GlanceEditor;
	editor.focused = true;
	h.runtime.events.agentStart({}, ctx.ctx);
	editor.render(180);
	assert.deepEqual(ctx.workingVisibility, [], "embedding, not a global visibility flag, owns the placement");
	await h.runtime.events.sessionShutdown({}, ctx.ctx);
	assert.deepEqual(ctx.workingVisibility, []);
});

test("Sweep follows native phases: working, fractional-speed summaries, retry blinking, then idle", async () => {
	const time = animationTime(), config = defaultConfig(); config.editor.activityMode = "sweep";
	const text = structuredClone(config); text.editor.activityMode = "text";
	const ctx = createRuntimeTestContext({ idle: false });
	const h = createRuntimeHarness({ loadConfigSyncConfig: config, git: createGitHarness(), workingSweepNowMs: time.now,
		scheduleSweepFrame: time.schedule, showPaneResults: [{ action: "save", config: text }] });
	h.runtime.events.sessionStart({}, ctx.ctx);
	const editor = invokeEditorFactory(ctx, 0, () => {}) as GlanceEditor;
	editor.focused = true; editor.setText("unchanged 中文🙂");
	const idle = editor.render(180);
	assert.equal(time.pending(), 0, "agent busy alone cannot invent a native activity");
	editor.setWorkingStatusIndicator(nativeActivity("working"));
	editor.render(180); time.advance(500);
	const working = editor.render(180);
	assert.notDeepEqual(working, idle);
	assert.deepEqual(working.map(stripTerminalSequences), idle.map(stripTerminalSequences));
	editor.setWorkingStatusIndicator(nativeActivity("compaction"));
	assert.deepEqual(editor.render(180), working, "changing sweep speed must preserve travelled distance");
	time.advance(500); assert.notDeepEqual(editor.render(180), working);
	editor.setWorkingStatusIndicator(nativeActivity("retry"));
	const bright = editor.render(180);
	assert.notDeepEqual(bright, idle);
	const inputBody = (lines: string[]) => lines.slice(config.editor.topMarginRows + 1, -1)
		.map(line => line.slice(line.indexOf("│") + 1, line.lastIndexOf("│")).replace(/^(?:\x1b\[[0-9;]*m)+|(?:\x1b\[[0-9;]*m)+$/g, ""));
	assert.deepEqual(inputBody(bright), inputBody(idle), "retry never flashes input or cursor markers");
	assert.equal(time.nextDelay(), 1000, "0.5 Hz has one second per half-cycle, not a 30 FPS blink loop");
	time.advance(1000); assert.deepEqual(editor.render(180), idle);
	time.advance(1000); assert.deepEqual(editor.render(180), bright);
	const stale = time.stale();
	await h.runtime.commands.openPane("", ctx.ctx);
	assert.equal(time.pending(), 0, "saving Text must immediately stop all Glance effects");
	stale(); assert.equal(time.pending(), 0);
	assert.ok(stripTerminalSequences(editor.render(180).at(-1)!).includes("DEMO retry"));
	editor.setWorkingStatusIndicator(undefined);
	assert.deepEqual(editor.render(180), idle);
	assert.deepEqual(ctx.workingVisibility, []);
	await h.runtime.events.sessionShutdown({}, ctx.ctx);
});

for (const outcome of ["save", "cancel", "failed", "readonly"] as const) test(`activity settings ${outcome} preserve the editor and apply atomically`, async () => {
	const time = animationTime(), config = defaultConfig(); config.editor.activityMode = "sweep";
	const next = structuredClone(config); next.editor.activityMode = "text"; next.editor.summarySpeedMultiplier = 1.35; next.editor.retryBlinkHz = 1;
	const ctx = createRuntimeTestContext();
	const h = createRuntimeHarness({ git: createGitHarness(), workingSweepNowMs: time.now, scheduleSweepFrame: time.schedule,
		loadConfigSyncResult: { config, status: outcome === "readonly" ? "future" : "loaded", writable: outcome !== "readonly" },
		saveConfigError: outcome === "failed" ? new Error("disk") : undefined,
		showPaneResults: [outcome === "cancel" ? { action: "cancel" } : { action: "save", config: next }],
	});
	h.runtime.events.sessionStart({}, ctx.ctx);
	const editor = invokeEditorFactory(ctx, 0, () => {}) as GlanceEditor;
	editor.focused = true; editor.setText("draft 中🙂");
	editor.setWorkingStatusIndicator(nativeActivity("branchSummary")); editor.render(180);
	time.advance(500); const before = editor.render(180), installs = [...ctx.surfaceCalls], cursor = editor.getCursor();
	await h.runtime.commands.openPane("", ctx.ctx);
	const after = editor.render(180);
	if (outcome === "save") { assert.match(stripTerminalSequences(after.at(-1)!), /DEMO branchSummary/); assert.equal(time.pending(), 0); }
	else { assert.deepEqual(after, before); assert.equal(time.pending(), 1); }
	assert.deepEqual(ctx.surfaceCalls, installs); assert.deepEqual(editor.getCursor(), cursor); assert.equal(editor.getText(), "draft 中🙂");
	await h.runtime.events.sessionShutdown({}, ctx.ctx); assert.equal(time.pending(), 0);
});

test("blocking prompts and editor ownership suspend effects without losing native state or leaking callbacks", async () => {
	const time = animationTime(), config = defaultConfig(); config.editor.activityMode = "sweep";
	const ctx = createRuntimeTestContext();
	const h = createRuntimeHarness({ loadConfigSyncConfig: config, git: createGitHarness(), workingSweepNowMs: time.now, scheduleSweepFrame: time.schedule });
	h.runtime.events.sessionStart({}, ctx.ctx);
	const editor = invokeEditorFactory(ctx, 0, () => {}) as GlanceEditor; editor.focused = true;
	editor.setWorkingStatusIndicator(nativeActivity("compaction")); editor.render(180); time.advance(600);
	const before = editor.render(180);
	h.runtime.events.uiPromptStart({}, ctx.ctx); assert.equal(time.pending(), 0);
	time.advance(5000); h.runtime.events.uiPromptEnd({}, ctx.ctx); assert.deepEqual(editor.render(180), before);
	const stale = time.stale(); ctx.setCurrentEditorFactory(() => ({}));
	time.advance(50); assert.equal(time.pending(), 0);
	await h.runtime.events.sessionShutdown({}, ctx.ctx); stale(); assert.equal(time.pending(), 0);
	assert.deepEqual(ctx.workingVisibility, []);
});
