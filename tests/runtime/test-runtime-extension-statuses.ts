import { strict as assert } from "node:assert";
import { test } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { defaultConfig } from "../../src/config/model.js";
import type { GlanceEditor } from "../../src/surface/editor.js";
import { createGitHarness, createRuntimeHarness, createRuntimeTestContext, invokeEditorFactory, invokeFooterFactory } from "../support/runtime-harness.js";

test("runtime bridges public footer data into the editor and settings, not a second footer line", async () => {
	const config = defaultConfig(); config.editor.activityMode = "text";
	const extensionStatuses = new Map([["mcp", "MCP: 3/3"]]);
	const ctx = createRuntimeTestContext({ extensionStatuses });
	const harness = createRuntimeHarness({ loadConfigSyncConfig: config, git: createGitHarness(), showPaneResults: [{ action: "cancel" }] });
	harness.runtime.events.sessionStart({}, ctx.ctx);
	const footer = invokeFooterFactory(ctx, 0, () => {}) as { render(width: number): string[] };
	const editor = invokeEditorFactory(ctx, 0, () => {}) as GlanceEditor;
	editor.focused = true; editor.setText("draft 中文🙂");
	const top = () => stripTerminalSequences(editor.render(240)[config.editor.topMarginRows]!);
	const first = top();
	assert.ok(first.includes("MCP: 3/3"), first);
	assert.ok(first.indexOf("󰄨") < first.indexOf("MCP:") && first.indexOf("MCP:") < first.indexOf("󰚩"));
	const entryReads = ctx.getEntryReads();
	extensionStatuses.set("mcp", "MCP: 2/3");
	assert.ok(top().includes("MCP: 2/3"));
	await harness.runtime.commands.openPane("", ctx.ctx);
	const previewSource = harness.showPaneOptions[0]?.getExtensionStatuses;
	assert.equal(previewSource?.()?.get("mcp"), "MCP: 2/3");
	extensionStatuses.clear(); assert.equal(top().includes("MCP:"), false);
	assert.equal(previewSource?.()?.size, 0, "settings must not retain a copy captured when opened");
	assert.deepEqual(footer.render(240), []);
	assert.equal(editor.getText(), "draft 中文🙂");
	assert.equal(ctx.getEntryReads(), entryReads);
});

test("footer ownership loss, shutdown and delayed old factories cannot retain a status source", async () => {
	const config = defaultConfig(), oldStatuses = new Map([["a", "old session"]]);
	const first = createRuntimeTestContext({ extensionStatuses: oldStatuses, invokeFooterFactory: false });
	const harness = createRuntimeHarness({ loadConfigSyncConfig: config, git: createGitHarness() });
	harness.runtime.events.sessionStart({}, first.ctx);
	const editor = invokeEditorFactory(first, 0, () => {}) as GlanceEditor;
	editor.focused = true;
	const render = () => editor.render(240).join("\n");
	assert.equal(render().includes("old session"), false);
	const footer = invokeFooterFactory(first, 0, () => {}) as { dispose(): void };
	assert.ok(render().includes("old session"));
	footer.dispose(); assert.equal(render().includes("old session"), false);
	await harness.runtime.events.sessionShutdown({}, first.ctx);
	const second = createRuntimeTestContext({ extensionStatuses: new Map([["a", "new session"]]) });
	harness.runtime.events.sessionStart({}, second.ctx);
	const next = invokeEditorFactory(second, 0, () => {}) as GlanceEditor; next.focused = true;
	const late = invokeFooterFactory(first, 0, () => {}) as { dispose(): void };
	late.dispose(); footer.dispose();
	const top = next.render(240).join("\n");
	assert.ok(top.includes("new session")); assert.equal(top.includes("old session"), false);
	assert.equal(oldStatuses.get("a"), "old session");
});

for (const action of ["disable", "shutdown"] as const) test(`${action} leaves a replacement footer untouched`, async () => {
	const config = defaultConfig(), disabled = { ...config, enabled: false };
	const ctx = createRuntimeTestContext({ invokeFooterFactory: false });
	const harness = createRuntimeHarness({ loadConfigSyncConfig: config, git: createGitHarness(), showPaneResults: [{ action: "save", config: disabled }] });
	harness.runtime.events.sessionStart({}, ctx.ctx);
	const footer = invokeFooterFactory(ctx, 0, () => {}) as { dispose(): void };
	// Pi calls dispose before installing another extension's custom footer.
	footer.dispose();
	ctx.ctx.ui.setFooter(() => ({ render: () => ["other extension"], invalidate() {} }));
	const baseline = ctx.surfaceCalls.length;
	if (action === "disable") await harness.runtime.commands.openPane("", ctx.ctx);
	else await harness.runtime.events.sessionShutdown({}, ctx.ctx);
	assert.equal(ctx.surfaceCalls.slice(baseline).includes("setFooter:clear"), false, "Glance must not replace a footer it no longer owns");
});
