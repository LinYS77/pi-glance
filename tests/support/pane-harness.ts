import { animationTime } from "./activity-harness.js";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../src/config/model.js";
import { GlanceConfigPane, type GlancePaneOptions } from "../../src/settings/pane.js";
import type { GlanceConfig } from "../../src/types.js";
import { richInputSurfaceState, stripAnsi } from "./surface-test-harness.js";

export const keys = { up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C", tab: "\t", backTab: "\x1b[Z", enter: "\r", esc: "\x1b", space: " " };
export function paneHarness(config = defaultConfig(), options: GlancePaneOptions = {}, keybindings?: Pick<KeybindingsManager, "matches" | "getKeys">) {
	let renders = 0, rows = 32;
	const time = animationTime();
	let completion: { action: "save"; config: GlanceConfig } | { action: "cancel" } | undefined;
	const pane = new GlanceConfigPane(config, { fg: (_tone: string, text: string) => text } as unknown as Theme,
		result => { completion = result; }, () => { renders++; }, keybindings, () => rows, richInputSurfaceState(), {
			previewNowMs: time.now,
			schedulePreviewFrame: time.schedule,
			...options,
		});
	pane.focused = true;
	return {
		pane, config, press: (...data: string[]) => data.forEach(key => pane.handleInput(key)),
		text: (width = 100) => pane.render(width).map(stripAnsi).join("\n"),
		completion: () => completion, pending: time.pending, renders: () => renders, stale: time.stale,
		height: (value: number) => { rows = value; },
		advance: time.advance,
	};
}
