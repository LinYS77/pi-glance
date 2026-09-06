import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getCapabilities, matchesKey, ProcessTerminal, truncateToWidth, TuiAltScreen } from "@earendil-works/pi-tui";
import { createConfigStore } from "../src/config/store.js";
import { WorkingSweep } from "../src/runtime/working-sweep.js";
import { renderInputSurfaceFrame } from "../src/surface/frame.js";
import { renderGlanceLine } from "../src/surface/status-line.js";
import { resolveGlanceRenderStyles, type ResolvedGlanceStyles } from "../src/theme/adapter.js";
import { selectGlanceTheme, type GlanceAmbientTone } from "../src/theme/selection.js";
import type { GlanceState } from "../src/types.js";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
	console.error("Run npm run preview:working in a terminal.");
	process.exit(1);
}

const agentDir = getAgentDir();
const config = createConfigStore(join(agentDir, "pi-glance", "config.json")).loadConfigSync().config;
config.enabled = true;
const cwd = process.cwd();
const state: GlanceState = {
	workspace: { name: basename(cwd), path: cwd },
	git: { repo: true, branch: "main", detached: false, sha: "abcdef1", upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, dirty: false, status: "clean", updatedAt: 0 },
	providers: { availableCount: 2 },
	model: { id: "pro-gpt-6-astra", displayName: "pro-gpt-6-astra", provider: "PRO", thinking: "xhigh" },
	context: { tokens: 240_000, window: 680_000, percent: 35.3 },
	usage: { input: 1_000_000, output: 1_700_000, cacheRead: 24_000_000, cacheWrite: 0, cost: 0.42 },
	throughput: {
		lastRun: { startedAtMs: 0, endedAtMs: 1000, elapsedMs: 1000, tokensPerSecond: 34, usage: { input: 0, output: 34, cacheRead: 0, cacheWrite: 0, totalTokens: 34, assistantMessages: 1 } },
		currentRun: null,
	},
	version: 0,
};
let tone: GlanceAmbientTone = "unknown";
try {
	const theme = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).theme;
	if (theme === "light" || theme === "dark") tone = theme;
} catch { /* Use the same unknown-tone fallback as Glance. */ }
if (process.argv.includes("--light")) tone = "light";
if (process.argv.includes("--dark")) tone = "dark";
let trueColor = process.argv.includes("--256") ? false : getCapabilities().trueColor;
let running = config.editor.workingSweep;
let shortPath = false;
let warnings = false;
let closed = false;
let cachedStatus: { budget: number; styleKey: string; version: number; text: string } | undefined;
function renderStatus(budget: number, styles: ResolvedGlanceStyles): string {
	if (cachedStatus?.budget === budget && cachedStatus.styleKey === styles.cacheKey && cachedStatus.version === state.version) return cachedStatus.text;
	const text = renderGlanceLine(state, config, budget, state.providers.availableCount, { styles });
	cachedStatus = { budget, styleKey: styles.cacheKey, version: state.version, text };
	return text;
}
const terminal = new ProcessTerminal();
const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
const sweep = new WorkingSweep({
	nowMs: () => performance.now(),
	ownsEditor: () => !closed,
	requestRender: () => tui.requestRender(),
	setWorkingVisible: () => {},
});

async function close(): Promise<void> {
	if (closed) return;
	closed = true;
	sweep.dispose();
	await terminal.drainInput();
	tui.stop();
	process.stdin.pause();
}
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
process.on("exit", () => { sweep.dispose(); tui.stop(); });

tui.addChild({
	invalidate() {},
	handleInput(data) {
		if (matchesKey(data, "q") || matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { void close(); return; }
		if (matchesKey(data, "space")) {
			running = !running;
			if (running) sweep.start(); else sweep.settle();
		} else if (matchesKey(data, "s")) {
			shortPath = !shortPath;
			state.workspace = shortPath ? { name: "p", path: "/p" } : { name: basename(cwd), path: cwd };
		} else if (matchesKey(data, "t")) {
			tone = tone === "dark" ? "light" : "dark";
		} else if (matchesKey(data, "c")) {
			trueColor = !trueColor;
		} else if (matchesKey(data, "e")) {
			warnings = !warnings;
			state.context.percent = warnings ? 92 : 35.3;
			state.context.tokens = warnings ? 625_600 : 240_000;
			state.git.status = warnings ? "conflict" : "clean";
			state.git.conflicts = warnings ? 1 : 0;
			state.version++;
		}
		tui.requestRender();
	},
	render(width) {
		return [
			"Glance 路径扫光 · 路径与连接线动态，右侧状态静止 · 演示数据",
			`${running ? "运行中" : "空闲（原版对照）"} · ${selectGlanceTheme(config.theme, tone)} · ${trueColor ? "RGB" : "ANSI 256"}`,
			"",
			...renderInputSurfaceFrame({
				state, config, width,
				styles: resolveGlanceRenderStyles(config.theme, { ambientTone: tone, trueColor }),
				body: { kind: "preview" },
				chrome: { workingElapsedMs: sweep.elapsedMs() },
				status: { render: renderStatus },
			}),
			"",
			"Space 开关动效 · S 长短路径 · T 配色 · C 色深 · E 告警 · Q 退出",
			"可直接调整终端宽度。退出后回到原终端，不切换 Pi 的扩展来源。",
		].map((line) => truncateToWidth(line, width));
	},
});
tui.setFocus(tui.children[0]!);
tui.start();
sweep.attach(running);
