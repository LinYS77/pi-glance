import { renderInputSurfaceFrame } from "./frame.js";
import { GlanceLineRenderer } from "./status-line.js";
import { resolveGlanceRenderStyles, type GlanceRenderStyleContext } from "../theme/adapter.js";
import type { GlanceConfig, GlanceState, WidthMode } from "../types.js";

interface InputSurfaceRenderOptions extends GlanceRenderStyleContext {
	workingElapsedMs?: number;
	contentLines?: string[];
	focused?: boolean;
	showTitle?: boolean;
	previewDensity?: WidthMode;
}

const PREVIEW_STATE: GlanceState = {
	workspace: { name: "pi-glance", path: "/Users/winnie/projects/pi-glance" },
	git: {
		repo: true,
		branch: "main",
		detached: false,
		sha: "a1b2c3d",
		upstream: "origin/main",
		ahead: 2,
		behind: 1,
		staged: 1,
		unstaged: 1,
		untracked: 0,
		conflicts: 0,
		dirty: true,
		status: "dirty",
		updatedAt: 0,
	},
	providers: { availableCount: 2 },
	model: { id: "claude-sonnet-4-20250514", provider: "anthropic", displayName: "Sonnet 4", thinking: "high" },
	context: { tokens: 46_800, window: 200_000, percent: 23.4 },
	usage: { input: 12_400, output: 3_100, cacheRead: 800, cacheWrite: 0, cost: 0.042 },
	throughput: { lastRun: null, currentRun: null },
	version: 0,
};

export function renderInputSurfacePreview(
	config: GlanceConfig,
	width: number,
	options: InputSurfaceRenderOptions = {},
): string[] {
	return renderInputSurface(PREVIEW_STATE, config, width, options);
}

export function renderInputSurface(
	state: GlanceState,
	config: GlanceConfig,
	width: number,
	options: InputSurfaceRenderOptions = {},
): string[] {
	return createInputSurfaceRenderer(state)(config, width, options);
}

/** Own the preview's cache without caching prompt text, layout or animation. */
export function createInputSurfaceRenderer(state: GlanceState = PREVIEW_STATE) {
	const statusLine = new GlanceLineRenderer();
	return (config: GlanceConfig, width: number, options: InputSurfaceRenderOptions = {}): string[] => {
		const styles = resolveGlanceRenderStyles(config.theme, options);
		return renderInputSurfaceFrame({
			state,
			config,
			width,
			styles,
			body: {
				kind: "preview",
				lines: options.contentLines,
				showPromptIndicator: Boolean(options.focused),
			},
			chrome: {
				workingElapsedMs: options.workingElapsedMs,
				showTitle: options.showTitle,
			},
			status: {
				render: (budget) =>
					statusLine.render(state, config, budget, state.providers.availableCount, {
						styles,
						widthMode: options.previewDensity,
					}),
			},
		});
	};
}
