import { performance } from "node:perf_hooks";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { defaultConfig } from "../src/config/model.js";
import { createInitialState } from "../src/runtime/state.js";
import { GlanceConfigPane } from "../src/settings/pane.js";
import { GlanceEditor } from "../src/surface/editor.js";

// Render real components with a fixed clock and no terminal, timers or config IO.
const identity = (text: string) => text;
const theme: EditorTheme = {
	borderColor: identity,
	selectList: {
		selectedPrefix: identity,
		selectedText: identity,
		description: identity,
		scrollInfo: identity,
		noMatch: identity,
	},
};
const tui = { terminal: { rows: 32 }, requestRender() {} } as unknown as TUI;
const keybindings = { matches: () => false } as unknown as KeybindingsManager;
const samples = 2000;
const results = [];

for (const trueColor of [true, false]) {
	for (const mode of ["top", "perimeter"] as const) {
		for (const width of [80, 160]) {
			const config = defaultConfig();
			config.editor.workingSweep = mode;
			const state = createInitialState(
				{
					cwd: "/projects/pi-glance",
					availableProviderCount: 2,
					thinkingLevel: "high",
					model: { id: "claude-sonnet-4", name: "Sonnet 4", provider: "anthropic", contextWindow: 200_000 },
					contextUsage: { tokens: 46_800, contextWindow: 200_000, percent: 23.4 },
					usage: { input: 12_400, output: 3_100, cacheRead: 800, cacheWrite: 0, cost: 0.042 },
				},
				config,
			);
			let now = 0;
			const editor = new GlanceEditor(
				tui,
				theme,
				keybindings,
				() => state,
				() => config,
				undefined,
				{
					getWorkingElapsedMs: () => now,
					renderStyleContext: { trueColor },
				},
			);
			editor.focused = true;
			editor.setText("Your next prompt…");
			const pane = new GlanceConfigPane(
				config,
				{ fg: (_tone, text) => text } as Pick<Theme, "fg">,
				() => {},
				() => {},
				undefined,
				() => 32,
				state,
				{
					previewNowMs: () => now,
					schedulePreviewFrame: () => () => {},
					renderStyleContext: { trueColor },
				},
			);
			pane.handleInput("\t");
			pane.handleInput("\t"); // Working section
			for (const [name, component] of [
				["editor", editor],
				["settings", pane],
			] as const) {
				for (let i = 0; i < 200; i++) {
					now += 1000 / 30;
					component.render(width);
				}
				const times: number[] = [];
				for (let i = 0; i < samples; i++) {
					now += 1000 / 30;
					const start = performance.now();
					component.render(width);
					times.push(performance.now() - start);
				}
				times.sort((a, b) => a - b);
				results.push({
					component: name,
					colors: trueColor ? "RGB" : "256",
					mode,
					width,
					medianMs: Number(times[Math.floor(samples * 0.5)]!.toFixed(4)),
					p95Ms: Number(times[Math.floor(samples * 0.95)]!.toFixed(4)),
				});
			}
			pane.dispose();
		}
	}
}
console.log(
	JSON.stringify({ node: process.version, platform: `${process.platform}/${process.arch}`, samples, results }, null, 2),
);
