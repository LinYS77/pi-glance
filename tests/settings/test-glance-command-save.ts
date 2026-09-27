import { strict as assert } from "node:assert";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piGlance from "../../index.js";
import { createConfigStore } from "../../src/config/store.js";
import { defaultConfig } from "../../src/config/model.js";
import { createRuntimeTestContext, invokeEditorFactory } from "../support/runtime-harness.js";
import type { GlanceEditor } from "../../src/surface/editor.js";
import { keys as k } from "../support/pane-harness.js";

async function waitFor(check: () => boolean): Promise<void> {
	for (let i = 0; i < 200; i++) { if (check()) return; await delay(5); }
	assert.fail("UI operation did not settle");
}

test("the real /glance command retries failed storage in the same pane and applies only after successful save", async () => {
	const before = process.env.PI_CODING_AGENT_DIR;
	const agent = await mkdtemp(join(tmpdir(), "glance-settings-transaction-"));
	process.env.PI_CODING_AGENT_DIR = agent;
	const events = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	const ctx = createRuntimeTestContext({ persistent: false, trusted: false });
	try {
		const directory = join(agent, "pi-glance"), store = createConfigStore(join(directory, "config.json"));
		const initial = defaultConfig(); initial.git.autoFetch = false;
		await store.saveConfig(initial);
		piGlance({ on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => events.set(name, handler),
			registerCommand: (_name: string, options: { handler: typeof command }) => { command = options.handler; },
			getThinkingLevel: () => "off" } as unknown as ExtensionAPI);
		events.get("session_start")!({}, ctx.ctx);
		const editor = invokeEditorFactory(ctx, 0, () => {}) as GlanceEditor;
		editor.setText("keep 中文🙂 draft");
		const factory = ctx.getCurrentEditorFactory();
		let pane: Component | undefined, closed = 0;
		ctx.ctx.ui.custom = (factory) => new Promise(resolve => {
			const finish = (value: unknown) => { closed++; resolve(value as never); };
			void Promise.resolve(factory({ terminal: { rows: 40 }, requestRender() {} } as never,
				{ fg: (_tone: string, text: string) => text } as never, undefined as never, finish)).then(value => { pane = value; });
		});
		const open = command("", ctx.ctx);
		await waitFor(() => pane !== undefined);
		await rm(directory, { recursive: true }); await writeFile(directory, "DEMO blocked directory");
		for (const key of [k.tab, k.tab, k.down, k.down, k.right, "s"]) pane!.handleInput!(key);
		await waitFor(() => closed > 0 || pane!.render(100).join("\n").includes("retry"));
		assert.equal(closed, 0, "write failure keeps the existing custom UI open");
		assert.match(pane!.render(100).join("\n"), /48 cols\/s/);
		assert.equal(ctx.getCurrentEditorFactory(), factory);
		await rm(directory); await mkdir(directory);
		pane!.handleInput!("s"); await open;
		assert.equal((await store.loadConfig()).config.editor.workingSweepSpeed, 48);
		assert.equal(closed, 1);
		assert.equal(ctx.getCurrentEditorFactory(), factory, "enabled save does not replace the editor");
		assert.equal(editor.getText(), "keep 中文🙂 draft");
	} finally {
		await events.get("session_shutdown")?.({}, ctx.ctx);
		if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before;
		await rm(agent, { recursive: true, force: true });
	}
});
