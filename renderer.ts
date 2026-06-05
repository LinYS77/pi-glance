import { truncateToWidth } from "@earendil-works/pi-tui";
import { PALETTES, fg } from "./palette.js";
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
import type { GlanceConfig, GlanceState } from "./types.js";

interface InputSurfaceRenderOptions {
	contentLines?: string[];
	focused?: boolean;
	showTitle?: boolean;
}

function borderColor(config: GlanceConfig, text: string): string {
	const palette = PALETTES[config.theme];
	return fg(palette.border, text);
}

function textColor(config: GlanceConfig, text: string): string {
	const palette = PALETTES[config.theme];
	return fg(palette.text, text);
}

function titleColor(config: GlanceConfig, text: string): string {
	const palette = PALETTES[config.theme];
	return fg(palette.title, text);
}

function dimColor(config: GlanceConfig, text: string): string {
	const palette = PALETTES[config.theme];
	return fg(palette.dim, text);
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
	const status = renderGlanceLine(state, config, statusBudget, state.providers.availableCount);
	const top = renderSurfaceChunks(planSurfaceTopFrame({ width: safeWidth, left: title, status }).chunks, {
		border: (text) => borderColor(config, text),
		title: (text) => titleColor(config, text),
		status: (text) => text,
		text: (text) => text,
		dim: (text) => dimColor(config, text),
	});
	const lines = [...renderSurfaceTopMargin(safeWidth, config.editor.topMarginRows), truncateToWidth(top, safeWidth, borderColor(config, "…"))];
	for (let i = 0; i < rows; i++) {
		const raw = contentLines[i] ?? "";
		const focusedPrefix = i === 0 && options.focused;
		const row = planSurfaceRow({
			width: safeWidth,
			text: raw,
			prefix: focusedPrefix ? "› " : "  ",
			ellipsis: dimColor(config, "…"),
			prefixRole: focusedPrefix ? "dim" : "text",
		});
		lines.push(
			renderSurfaceChunks(row.chunks, {
				border: (text) => borderColor(config, text),
				content: (text) => textColor(config, text),
				dim: (text) => dimColor(config, text),
				text: (text) => text,
			}),
		);
	}
	lines.push(
		renderSurfaceChunks(planSurfaceBottomFrame({ width: safeWidth }).chunks, {
			border: (text) => borderColor(config, text),
		}),
	);
	return lines;
}
