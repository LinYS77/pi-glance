import { getCapabilities, KeybindingsManager as TuiKeys, matchesKey, ProcessTerminal, Text, TUI_KEYBINDINGS, TuiAltScreen, type EditorTheme } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../src/config/model.js";
import { PromptStash } from "../src/input/stash.js";
import { createInitialState } from "../src/runtime/state.js";
import { GlanceConfigPane } from "../src/settings/pane.js";
import { GlanceEditor } from "../src/surface/editor.js";
import { resolveBuiltInGlanceStyles } from "../src/theme/adapter.js";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
	console.error("Run npm run preview:input in a terminal.");
	process.exit(1);
}
const terminal = new ProcessTerminal();
const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
const trueColor = !process.argv.includes("--256") && getCapabilities().trueColor;
const tone = process.argv.includes("--light") ? "light" : "dark";
const styles = resolveBuiltInGlanceStyles(tone, trueColor ? "truecolor" : "ansi256");
const identity = (text: string) => text;
const theme: EditorTheme = {
	borderColor: styles.border,
	selectList: { selectedPrefix: styles.title, selectedText: styles.title, description: styles.dim, scrollInfo: styles.dim, noMatch: styles.warn },
};
let config = defaultConfig();
const definitions = { ...TUI_KEYBINDINGS, "app.clear": { defaultKeys: "ctrl+c" as const }, "preview.settings": { defaultKeys: "f2" as const } };
const keybindings = Object.assign(new TuiKeys(definitions), {
	getEffectiveConfig: () => Object.fromEntries(Object.entries(definitions).map(([key, definition]) => [key, definition.defaultKeys])),
}) as unknown as KeybindingsManager;
const state = createInitialState({
	cwd: "/projects/pi-glance", availableProviderCount: 1, thinkingLevel: "high",
	model: { id: "example-model", name: "Example model", provider: "preview", contextWindow: 200_000 },
	contextUsage: { tokens: 24_000, contextWindow: 200_000, percent: 12 },
	usage: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, cost: 0.01 },
}, config);
state.git = { ...state.git, repo: true, branch: "feature/stash", status: "dirty", dirty: true, ahead: 2, summary: { files: 3, additions: 42, deletions: 8 } };
const notice = new Text("alt+s stash / restore · f2 settings · enter clears input · ctrl+c close\nExample Git data. No model calls, network or file writes.", 0, 1, identity);
const editor = new GlanceEditor(tui, theme, keybindings, () => state, () => config, undefined, {
	stash: new PromptStash(null, () => {}),
	renderStyleContext: { ambientTone: tone, trueColor },
	onStashError: text => { notice.setText(text); tui.requestRender(); },
});
let pane: GlanceConfigPane | undefined;
let closed = false;
editor.onSubmit = () => tui.requestRender();
editor.onExtensionShortcut = data => {
	if (!matchesKey(data, "f2")) return false;
	pane = new GlanceConfigPane(config, {
		fg: (color, text) => (color === "accent" ? styles.title : color === "warning" ? styles.warn : styles.dim)(text),
	}, result => {
		if (result.action === "save") config = result.config;
		if (pane) tui.removeChild(pane);
		pane = undefined;
		tui.addChild(editor); tui.setFocus(editor); tui.requestRender();
	}, () => tui.requestRender(), keybindings, () => terminal.rows, state, { renderStyleContext: { ambientTone: tone, trueColor } });
	tui.removeChild(editor); tui.addChild(pane); tui.setFocus(pane); tui.requestRender();
	return true;
};
async function close() {
	if (closed) return;
	closed = true; pane?.dispose();
	await terminal.drainInput(); tui.stop(); process.stdin.pause();
	console.log("Preview closed. Nothing was saved.");
}
editor.onAction("app.clear", () => { void close(); });
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
process.on("exit", () => { pane?.dispose(); tui.stop(); });
tui.addChild(notice); tui.addChild(editor); tui.setFocus(editor); tui.start();
