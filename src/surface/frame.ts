import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { renderGlanceLine } from "./status-line.js";
import { createTopEdgeSweep } from "./top-edge-sweep.js";
import { createPerimeterSweep, type PerimeterSweep } from "./perimeter-sweep.js";
import {
	planSurfaceBottomFrame,
	planSurfaceRow,
	planSurfaceStatusBudget,
	planSurfaceTopFrame,
	planWorkspaceTitle,
	renderSurfaceChunks,
	renderSurfaceTopMargin,
	surfaceMetrics,
	SURFACE_AUTOCOMPLETE_INDENT,
	SURFACE_CONTENT_PADDING_X,
} from "./layout.js";
import type { ResolvedGlanceStyles, TextStyler } from "../theme/adapter.js";
import type { GlanceConfig, GlanceState } from "../types.js";

export type InputSurfaceChromeFocus = "focused" | "unfocused";

export interface InputSurfaceFrameMetrics {
	safeWidth: number;
	innerWidth: number;
	editorContentWidth: number;
	autocompleteIndent: number;
}

export type InputSurfaceFrameBody =
	| { kind: "preview"; lines?: readonly string[]; showPromptIndicator?: boolean }
	| { kind: "editor"; lines: readonly string[] };

export interface InputSurfaceFrameChrome {
	workingElapsedMs?: number;
	focus?: InputSurfaceChromeFocus;
	showTitle?: boolean;
	topScrollIndicator?: string;
	bottomScrollIndicator?: string;
}

export interface InputSurfaceFrameStatus {
	render?: (budget: number, styles: ResolvedGlanceStyles) => string;
}

export interface InputSurfaceFrameInput {
	state: GlanceState;
	config: GlanceConfig;
	width: number;
	styles: ResolvedGlanceStyles;
	body: InputSurfaceFrameBody;
	chrome?: InputSurfaceFrameChrome;
	status?: InputSurfaceFrameStatus;
}

function identity(text: string): string {
	return text;
}

function stripControlsPreservingSpaces(text: string): string {
	return text
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/[\r\n\t]/g, " ");
}

function minContentRows(config: GlanceConfig): number {
	return Math.max(2, Math.min(4, config.editor.minContentRows));
}

function shouldDimChrome(input: InputSurfaceFrameInput): boolean {
	return input.body.kind === "editor" && input.chrome?.focus === "unfocused";
}

function resolveStatus(input: InputSurfaceFrameInput, budget: number): string {
	const status = input.status?.render
		? input.status.render(budget, input.styles)
		: renderGlanceLine(input.state, input.config, budget, input.state.providers.availableCount, { styles: input.styles });
	if (!status || !shouldDimChrome(input)) return status;
	return input.styles.dim(stripControlsPreservingSpaces(status));
}

function topLeftPlan(input: InputSurfaceFrameInput, metrics: Pick<InputSurfaceFrameMetrics, "safeWidth" | "innerWidth">) {
	const scrollIndicator = input.chrome?.topScrollIndicator;
	if (scrollIndicator) {
		const chunks = [{ role: "border" as const, text: scrollIndicator }];
		return { chunks, width: visibleWidth(scrollIndicator) };
	}

	return planWorkspaceTitle({
		workspacePath: input.state.workspace.path,
		workspaceName: input.state.workspace.name,
		mode: input.config.display.workspaceLabel,
		innerWidth: metrics.innerWidth,
		surfaceWidth: metrics.safeWidth,
		showTitle: input.chrome?.showTitle,
	});
}

function planTopFrame(input: InputSurfaceFrameInput, metrics: Pick<InputSurfaceFrameMetrics, "safeWidth" | "innerWidth">) {
	const left = topLeftPlan(input, metrics);
	const statusBudget = planSurfaceStatusBudget(metrics.innerWidth, left.width);
	return planSurfaceTopFrame({ width: metrics.safeWidth, left, status: resolveStatus(input, statusBudget) });
}

function renderTopFrame(input: InputSurfaceFrameInput, plan: ReturnType<typeof planSurfaceTopFrame>, perimeter?: PerimeterSweep): string {
	const dimChrome = shouldDimChrome(input);
	const border = dimChrome ? input.styles.dim : input.styles.border;
	const title = dimChrome ? input.styles.dim : input.styles.title;
	const elapsed = !input.config.enabled || dimChrome || input.config.editor.workingSweep !== "top" ? undefined : input.chrome?.workingElapsedMs;
	const sweepWidth = plan.leftWidth + plan.fillerWidth;
	const sweep = elapsed === undefined ? undefined : createTopEdgeSweep(sweepWidth, elapsed, input.styles);
	let column = 0;
	const rendered = plan.chunks.map((chunk) => {
		const start = column;
		column += visibleWidth(chunk.text);
		if (chunk.role === "status") return chunk.text;
		if (chunk.role === "title") return perimeter ? perimeter(chunk.text, title, start, 0) : sweep ? sweep(chunk.text, title, start - 1) : title(chunk.text);
		if (chunk.role === "border" || chunk.role === "dim") {
			if (perimeter && /^[╭╮─]+$/.test(chunk.text)) return perimeter(chunk.text, border, start, 0);
			// Top-edge mode keeps the corners and status-side tail static.
			return sweep && start >= 1 && start < 1 + sweepWidth && /^─+$/.test(chunk.text)
				? sweep(chunk.text, border, start - 1)
				: border(chunk.text);
		}
		return chunk.text;
	}).join("");
	return truncateToWidth(rendered, plan.safeWidth, border("…"));
}

function rowBorder(border: TextStyler, width: number, row: number, perimeter?: PerimeterSweep): TextStyler {
	if (!perimeter) return border;
	let column = 0;
	return (text) => {
		const rendered = perimeter(text, border, column, row);
		column = width - 1;
		return rendered;
	};
}

function renderPreviewRow(input: InputSurfaceFrameInput, text: string, index: number, width: number, perimeter?: PerimeterSweep): string {
	const showPromptIndicator = input.body.kind === "preview" && input.body.showPromptIndicator === true && index === 0;
	return renderSurfaceChunks(
		planSurfaceRow({
			width,
			text,
			prefix: showPromptIndicator ? "› " : "  ",
			ellipsis: input.styles.dim("…"),
			prefixRole: showPromptIndicator ? "dim" : "text",
		}).chunks,
		{
			border: rowBorder(input.styles.border, width, index + 1, perimeter),
			content: input.styles.text,
			dim: input.styles.dim,
			text: identity,
		},
	);
}

function renderEditorRow(input: InputSurfaceFrameInput, text: string, index: number, width: number, perimeter?: PerimeterSweep): string {
	const border = shouldDimChrome(input) ? input.styles.dim : input.styles.border;
	return renderSurfaceChunks(
		planSurfaceRow({
			width,
			text,
			paddingX: SURFACE_CONTENT_PADDING_X,
			reserveRightPadding: true,
			ellipsis: "",
		}).chunks,
		{
			border: rowBorder(border, width, index + 1, perimeter),
			content: identity,
			text: identity,
		},
	);
}

function bodyLines(body: InputSurfaceFrameBody): readonly string[] {
	if (body.kind === "preview") return body.lines ?? [""];
	return body.lines;
}

function renderBodyRow(input: InputSurfaceFrameInput, text: string, index: number, width: number, perimeter?: PerimeterSweep): string {
	return input.body.kind === "preview"
		? renderPreviewRow(input, text, index, width, perimeter)
		: renderEditorRow(input, text, index, width, perimeter);
}

function renderBottomFrame(input: InputSurfaceFrameInput, width: number, row: number, perimeter?: PerimeterSweep): string {
	const border = shouldDimChrome(input) ? input.styles.dim : input.styles.border;
	let column = 0;
	return renderSurfaceChunks(planSurfaceBottomFrame({ width, scrollIndicator: input.chrome?.bottomScrollIndicator }).chunks, {
		border: (text) => {
			const start = column;
			column += visibleWidth(text);
			return perimeter && /^[╰╯─]+$/.test(text) ? perimeter(text, border, start, row) : border(text);
		},
	});
}

export function measureInputSurfaceFrame(width: number): InputSurfaceFrameMetrics {
	const { safeWidth, innerWidth } = surfaceMetrics(width);
	return {
		safeWidth,
		innerWidth,
		editorContentWidth: Math.max(1, safeWidth - 2 - SURFACE_CONTENT_PADDING_X * 2),
		autocompleteIndent: Math.min(SURFACE_AUTOCOMPLETE_INDENT, Math.max(0, safeWidth - 1)),
	};
}

export function renderInputSurfaceFrame(input: InputSurfaceFrameInput): string[] {
	const metrics = measureInputSurfaceFrame(input.width);
	const sourceLines = bodyLines(input.body);
	const rows = Math.max(minContentRows(input.config), sourceLines.length);
	const top = planTopFrame(input, metrics);
	const topGap = top.status.text ? { column: 1 + top.leftWidth + top.fillerWidth, width: top.status.width + 2 } : undefined;
	const elapsed = input.chrome?.workingElapsedMs;
	const perimeter = input.config.enabled && input.config.editor.workingSweep === "perimeter" && !shouldDimChrome(input) && elapsed !== undefined
		? createPerimeterSweep(metrics.safeWidth, rows, elapsed, input.styles, topGap)
		: undefined;
	const lines = [
		...renderSurfaceTopMargin(metrics.safeWidth, input.config.editor.topMarginRows),
		renderTopFrame(input, top, perimeter),
	];

	for (let i = 0; i < rows; i++) {
		lines.push(renderBodyRow(input, sourceLines[i] ?? "", i, metrics.safeWidth, perimeter));
	}

	lines.push(renderBottomFrame(input, metrics.safeWidth, rows + 1, perimeter));
	return lines;
}
