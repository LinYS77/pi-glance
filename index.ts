import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadConfig, saveConfig } from "./config.js";
import { GlanceEditor } from "./editor.js";
import { GlanceFooterBridge } from "./footer-bridge.js";
import { showGlancePane } from "./pane.js";
import { computeUsageTotals, createInitialState, refreshContextUsage, refreshModel, refreshWorkspace, setUsageTotals } from "./state.js";
import type { GlanceConfig, GlanceState } from "./types.js";

export default function piGlance(pi: ExtensionAPI): void {
	let config: GlanceConfig | undefined;
	let state: GlanceState | undefined;
	let footerBridge: GlanceFooterBridge | undefined;
	let requestRender: (() => void) | undefined;

	async function ensureConfig(): Promise<GlanceConfig> {
		config ??= await loadConfig();
		return config;
	}

	function getConfig(): GlanceConfig {
		if (!config) throw new Error("pi-glance config not loaded");
		return config;
	}

	function ensureState(ctx: ExtensionContext): GlanceState {
		if (!state) {
			state = createInitialState(ctx, getConfig(), pi.getThinkingLevel());
		}
		return state;
	}

	function renderNow(): void {
		footerBridge?.invalidate();
		requestRender?.();
	}

	function refreshReliableSnapshot(ctx: ExtensionContext, options: { model?: boolean } = {}): void {
		if (!state) return;
		refreshWorkspace(state, ctx);
		if (options.model) refreshModel(state, ctx, getConfig(), pi.getThinkingLevel());
		setUsageTotals(state, computeUsageTotals(ctx));
		refreshContextUsage(state, ctx);
	}

	function refreshThinkingLevel(ctx: ExtensionContext): void {
		if (!state) return;
		refreshModel(state, ctx, getConfig(), pi.getThinkingLevel());
	}

	function clearBridge(): void {
		footerBridge?.dispose();
		footerBridge = undefined;
	}

	function clearUI(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		clearBridge();
		ctx.ui.setEditorComponent(undefined);
		ctx.ui.setFooter(undefined);
		requestRender = undefined;
	}

	function installInputSurface(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ensureState(ctx);
		const activeConfig = getConfig();
		if (!activeConfig.enabled) {
			clearUI(ctx);
			return;
		}

		clearBridge();
		ctx.ui.setFooter((tui, _theme, footerData) => {
			requestRender = () => tui.requestRender();
			footerBridge = new GlanceFooterBridge(tui, () => state ?? ensureState(ctx), footerData);
			return footerBridge;
		});

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			requestRender = () => tui.requestRender();
			return new GlanceEditor(
				tui,
				theme,
				keybindings,
				() => state ?? ensureState(ctx),
				() => getConfig(),
				() => {
					refreshThinkingLevel(ctx);
					renderNow();
				},
			);
		});
	}

	pi.registerCommand("glance", {
		description: "Open pi-glance configuration pane",
		handler: async (_args, ctx) => {
			const current = await ensureConfig();
			ensureState(ctx);
			const result = await showGlancePane(current, ctx, state);
			if (result.action === "cancel") {
				ctx.ui.notify("pi-glance configuration cancelled", "info");
				return;
			}

			config = result.config;
			await saveConfig(config);
			if (state) {
				refreshReliableSnapshot(ctx, { model: true });
			}
			installInputSurface(ctx);
			renderNow();
			ctx.ui.notify("pi-glance configuration saved", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		config = await loadConfig();
		state = createInitialState(ctx, config, pi.getThinkingLevel());
		installInputSurface(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		clearUI(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx, { model: true });
		renderNow();
	});

	pi.on("turn_start", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx, { model: true });
		renderNow();
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx);
		renderNow();
	});

	pi.on("session_tree", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx, { model: true });
		renderNow();
	});

	pi.on("session_compact", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx, { model: true });
		renderNow();
	});

	pi.on("message_end", async (event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		if (event.message.role === "assistant") {
			refreshReliableSnapshot(ctx);
			renderNow();
		}
	});

	pi.on("turn_end", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx);
		renderNow();
	});

	pi.on("agent_end", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx);
		renderNow();
	});
}
