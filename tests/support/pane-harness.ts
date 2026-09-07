import { strict as assert } from "node:assert";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { GlanceConfigPane, type GlancePaneOptions } from "../../src/settings/pane.js";
import type { GlanceConfig } from "../../src/types.js";
import { richInputSurfaceState, stripAnsi } from "./surface-test-harness.js";

export const keys = { up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C", tab: "\t", backTab: "\x1b[Z", enter: "\r", esc: "\x1b", space: " " };
export function paneHarness(config = defaultConfig(), options: GlancePaneOptions = {}, keybindings?: Pick<KeybindingsManager, "matches" | "getKeys">) {
	let now = 0, renders = 0, rows = 32;
	let completion: { action: "save"; config: GlanceConfig } | { action: "cancel" } | undefined;
	const tasks = new Set<() => void>();
	let last = () => {};
	const pane = new GlanceConfigPane(config, { fg: (_tone: string, text: string) => text } as unknown as Theme,
		result => { completion = result; }, () => { renders++; }, keybindings, () => rows, richInputSurfaceState(), {
			previewNowMs: () => now,
			schedulePreviewFrame: (callback, delay) => { assert.ok(delay >= 33 && delay <= 34); last = callback; tasks.add(callback); return () => { tasks.delete(callback); }; },
			...options,
		});
	pane.focused = true;
	return {
		pane, config, press: (...data: string[]) => data.forEach(key => pane.handleInput(key)),
		text: (width = 100) => pane.render(width).map(stripAnsi).join("\n"),
		completion: () => completion, pending: () => tasks.size, renders: () => renders, stale: () => last,
		height: (value: number) => { rows = value; },
		advance: (ms: number) => { now += ms; for (const task of [...tasks]) { tasks.delete(task); task(); } },
	};
}
