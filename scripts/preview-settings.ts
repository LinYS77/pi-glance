import { getCapabilities, ProcessTerminal, TuiAltScreen } from "@earendil-works/pi-tui";
import { defaultConfig } from "../src/config/model.js";
import { GlanceConfigPane } from "../src/settings/pane.js";
import { resolveBuiltInGlanceStyles } from "../src/theme/adapter.js";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
	console.error("Run npm run preview:settings in a terminal.");
	process.exit(1);
}
const tone = process.argv.includes("--light") ? "light" : "dark";
const trueColor = !process.argv.includes("--256") && getCapabilities().trueColor;
const styles = resolveBuiltInGlanceStyles(tone, trueColor ? "truecolor" : "ansi256");
const terminal = new ProcessTerminal();
const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
let closed = false;
const pane = new GlanceConfigPane(defaultConfig(), {
	fg: (color, text) => (color === "accent" ? styles.title : color === "warning" ? styles.warn : color === "dim" ? styles.dim : styles.text)(text),
}, () => { void close(); }, () => tui.requestRender(), undefined, () => terminal.rows, undefined, { renderStyleContext: { ambientTone: tone, trueColor } });
async function close(): Promise<void> {
	if (closed) return;
	closed = true;
	pane.dispose();
	await terminal.drainInput();
	tui.stop();
	process.stdin.pause();
	console.log("Preview closed. No settings were saved.");
}
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
process.on("exit", () => { pane.dispose(); tui.stop(); });
tui.addChild(pane);
tui.setFocus(pane);
tui.start();
