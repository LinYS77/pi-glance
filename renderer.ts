import { truncateToWidth } from "@earendil-works/pi-tui";
import {
	planSurfaceBottomFrame,
	planSurfaceRow,
	planSurfaceStatusBudget,
	planSurfaceTopFrame,
	planWorkspaceTitle,
	renderSurfaceChunks,
	renderSurfaceTopMargin,
	surfaceMetrics,
} from "./surface-layout.js";
import { renderGlanceLine } from "./status-line.js";
import { resolveGlanceRenderStyles, type GlanceRenderStyleContext } from "./theme-adapter.js";
import type { GlanceConfig, GlanceState } from "./types.js";

interface InputSurfaceRenderOptions extends GlanceRenderStyleContext {
	contentLines?: string[];
	focused?: boolean;
	showTitle?: boolean;
}

export function renderInputSurfacePreview(config: GlanceConfig, width: number, options: InputSurfaceRenderOptions = {}): string[] {
	const state: GlanceState = {
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
			updatedAt: Date.now(),
		},
		providers: { availableCount: 2 },
		model: { id: "claude-sonnet-4-20250514", provider: "anthropic", displayName: "Sonnet 4", thinking: "high" },
		context: { tokens: 46_800, window: 200_000, percent: 23.4 },
		usage: { input: 12_400, output: 3_100, cacheRead: 800, cacheWrite: 0, cost: 0.042 },
		throughput: { lastTurn: null, currentRun: null },
		version: 0,
	};
	return renderInputSurface(state, config, width, options);
}

export function renderInputSurface(
	state: GlanceState,
	config: GlanceConfig,
	width: number,
	options: InputSurfaceRenderOptions = {},
): string[] {
	const { safeWidth, innerWidth } = surfaceMetrics(width);
	const styles = resolveGlanceRenderStyles(config.theme, options);
	const minRows = Math.max(2, Math.min(4, config.editor.minContentRows));
	const contentLines = options.contentLines ?? [""];
	const rows = Math.max(minRows, contentLines.length);
	const title = planWorkspaceTitle({
		workspacePath: state.workspace.path,
		workspaceName: state.workspace.name,
		mode: config.display.workspaceLabel,
		innerWidth,
		surfaceWidth: safeWidth,
		showTitle: options.showTitle,
	});
	const statusBudget = planSurfaceStatusBudget(innerWidth, title.width);
	const status = renderGlanceLine(state, config, statusBudget, state.providers.availableCount, { styles });
	const top = renderSurfaceChunks(planSurfaceTopFrame({ width: safeWidth, left: title, status }).chunks, {
		border: styles.border,
		title: styles.title,
		status: (text) => text,
		text: (text) => text,
		dim: styles.dim,
	});
	const lines = [...renderSurfaceTopMargin(safeWidth, config.editor.topMarginRows), truncateToWidth(top, safeWidth, styles.border("…"))];
	for (let i = 0; i < rows; i++) {
		const raw = contentLines[i] ?? "";
		const focusedPrefix = i === 0 && options.focused;
		const row = planSurfaceRow({
			width: safeWidth,
			text: raw,
			prefix: focusedPrefix ? "› " : "  ",
			ellipsis: styles.dim("…"),
			prefixRole: focusedPrefix ? "dim" : "text",
		});
		lines.push(
			renderSurfaceChunks(row.chunks, {
				border: styles.border,
				content: styles.text,
				dim: styles.dim,
				text: (text) => text,
			}),
		);
	}
	lines.push(
		renderSurfaceChunks(planSurfaceBottomFrame({ width: safeWidth }).chunks, {
			border: styles.border,
		}),
	);
	return lines;
}
