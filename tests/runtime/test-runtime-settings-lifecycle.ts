import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig } from "../../src/config/model.js";
import { createGitHarness, createRuntimeHarness, createRuntimeTestContext } from "../support/runtime-harness.js";

test("a save finishing after shutdown cannot resurrect the old editor or affect a replacement session", async () => {
	const initial = defaultConfig(); initial.enabled = false;
	const next = defaultConfig();
	let finishSave!: () => void;
	let saving!: () => void;
	const pending = new Promise<void>(resolve => { finishSave = resolve; });
	const entered = new Promise<void>(resolve => { saving = resolve; });
	const h = createRuntimeHarness({ loadConfigSyncConfig: initial, git: createGitHarness(),
		showPaneResults: [{ action: "save", config: next }],
		onSaveConfig: async () => { saving(); await pending; } });
	const old = createRuntimeTestContext(), replacement = createRuntimeTestContext();
	h.runtime.events.sessionStart({}, old.ctx);
	const command = h.runtime.commands.openPane("", old.ctx);
	await entered;
	await h.runtime.events.sessionShutdown({}, old.ctx);
	h.runtime.events.sessionStart({}, replacement.ctx);
	finishSave(); await command;
	assert.equal(old.getCurrentEditorFactory(), undefined, "retired context must not get a new editor");
	assert.equal(replacement.getCurrentEditorFactory(), undefined, "late active config must not enable the replacement session");
	assert.deepEqual(old.notifications, [], "late work does not send an obsolete success notification");
	await h.runtime.events.sessionShutdown({}, replacement.ctx);
});
