import { strict as assert } from "node:assert";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import type { GlanceEditor } from "../../src/surface/editor.js";
import { resolveBuiltInGlanceStyles } from "../../src/theme/adapter.js";
import { createGitHarness, createRuntimeHarness, createRuntimeTestContext, invokeEditorFactory } from "../support/runtime-harness.js";

// Both preferences use the same save transaction. Exercise that boundary once.
for (const outcome of ["save", "cancel", "failed", "readonly"] as const) test(`${outcome}: display preferences apply atomically to the existing input surface`, async () => {
	const config = defaultConfig(), next = structuredClone(config);
	next.editor.workingSweepColor = "blue";
	next.segments.find(s => s.id === "extensions")!.enabled = false;
	const statuses = new Map([["worker", "\x1b[31mExternal ready\x1b[0m"]]);
	let now = 0;
	const ctx = createRuntimeTestContext({ idle: false, extensionStatuses: statuses });
	const harness = createRuntimeHarness({
		loadConfigSyncResult: { config, status: outcome === "readonly" ? "future" : "loaded", writable: outcome !== "readonly" },
		showPaneResults: [outcome === "cancel" ? { action: "cancel" } : { action: "save", config: next }],
		saveConfigError: outcome === "failed" ? new Error("blocked") : undefined,
		git: createGitHarness(), workingSweepNowMs: () => now,
	});
	harness.runtime.events.sessionStart({}, ctx.ctx);
	const editor = invokeEditorFactory(ctx, 0, () => {}) as GlanceEditor;
	editor.focused = true; editor.setText("keep 中文🙂 draft");
	now = 1200;
	const before = editor.render(220), installs = [...ctx.surfaceCalls];
	assert.ok(before.join("").includes("\x1b[31mExternal ready"));
	await harness.runtime.commands.openPane("", ctx.ctx);
	const after = editor.render(220);
	if (outcome === "save") {
		const blue = resolveBuiltInGlanceStyles("light", "truecolor", "blue");
		const peak = blue.highlight!(blue.border, 1)("beam").match(/\x1b\[38;2;[^m]*m/)![0];
		assert.ok(after.join("").includes(peak), "the live beam uses the saved color");
		assert.equal(after.join("").includes("External ready"), false);
	} else assert.deepEqual(after, before, "unsaved preferences cannot leak into the live frame");
	const coreColumns = (lines: string[]) => lines.map(line => [...line.matchAll(/\x1b\[1m/g)].map(match => visibleWidth(line.slice(0, match.index))));
	assert.deepEqual(coreColumns(after), coreColumns(before), "color changes do not restart the beam");
	assert.deepEqual(after.slice(2).map(stripTerminalSequences), before.slice(2).map(stripTerminalSequences));
	assert.deepEqual(ctx.surfaceCalls, installs, "saving cannot reinstall the editor/footer");
	assert.equal(editor.getText(), "keep 中文🙂 draft");
	assert.equal(statuses.get("worker"), "\x1b[31mExternal ready\x1b[0m", "hiding never clears publisher-owned data");
	assert.equal(harness.savedConfigs.length, outcome === "save" ? 1 : 0);
	await harness.runtime.events.sessionShutdown({}, ctx.ctx);
});
