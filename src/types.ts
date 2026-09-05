import type { GlanceThemeName } from "./theme/themes.js";

export type { GlanceThemeName } from "./theme/themes.js";

export interface GlanceThemePair {
	light: GlanceThemeName;
	dark: GlanceThemeName;
}

export type SegmentId = "git" | "model" | "context" | "tokens" | "cost" | "throughput";
export type IconMode = "nerd" | "plain";
export type WidthMode = "full" | "compact" | "minimal";
export type GitStatus = "clean" | "dirty" | "conflict" | "unknown";
export type GitShaMode = "off" | "detached" | "always";
export type ContextDisplayMode = "percent+tokens" | "percent" | "tokens";
export type ContextUnknownMode = "show" | "hide";
export type TokensDisplayMode = "input-output" | "total";
export type TokensCacheMode = "rate" | "read-write" | "hide";
export type ModelThinkingMode = "auto" | "always" | "never";
export type WorkspaceLabelMode = "name" | "smart" | "path";
export type EditorTopMarginRows = 0 | 1 | 2;
export type ThroughputPrecision = "auto" | 0 | 1;

export interface SegmentConfig {
	id: SegmentId;
	enabled: boolean;
}

interface DisplayConfig {
	showProvider: "auto" | "always" | "never";
	workspaceLabel: WorkspaceLabelMode;
}

interface EditorConfig {
	minContentRows: number;
	topMarginRows: EditorTopMarginRows;
}

export interface GitConfig {
	showDirty: boolean;
	showAheadBehind: boolean;
	shaMode: GitShaMode;
	timeoutMs: number;
	refreshDebounceMs: number;
	pollIntervalMs: number;
}

interface ContextConfig {
	display: ContextDisplayMode;
	unknown: ContextUnknownMode;
}

interface CostConfig {
	hideZero: boolean;
}

interface TokensConfig {
	display: TokensDisplayMode;
	cache: TokensCacheMode;
}

interface ThroughputConfig {
	precision: ThroughputPrecision;
}

export interface GlanceConfig {
	version: 8;
	enabled: boolean;
	theme: GlanceThemePair;
	icons: IconMode;
	editor: EditorConfig;
	display: DisplayConfig;
	segments: SegmentConfig[];
	model: {
		customNames: Record<string, string>;
		showThinking: ModelThinkingMode;
	};
	git: GitConfig;
	context: ContextConfig;
	cost: CostConfig;
	tokens: TokensConfig;
	throughput: ThroughputConfig;
}

/**
 * Billed usage accumulated across the whole persisted Pi session: assistant
 * responses, usage-bearing tool results, compactions, and branch summaries.
 * Token cache rate is derived from these same session totals.
 */
export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface ModelSpeedUsage {
	input: number;
	/** Provider output tokens with the reported reasoning subset removed when available. */
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	assistantMessages: number;
}

export interface ModelSpeedMeasurement {
	/** First measured non-reasoning text or tool-call output delta timestamp. */
	startedAtMs: number;
	/** Last measured non-reasoning text or tool-call output delta timestamp. */
	endedAtMs: number;
	/** Sum of active non-reasoning output-stream intervals across the settled run. */
	elapsedMs: number;
	tokensPerSecond: number;
	usage: ModelSpeedUsage;
}

export interface GitSnapshot {
	repo: boolean;
	branch: string | null;
	detached: boolean;
	sha: string | null;
	upstream: string | null;
	ahead: number;
	behind: number;
	staged: number;
	unstaged: number;
	untracked: number;
	conflicts: number;
	dirty: boolean;
	status: GitStatus;
	updatedAt: number;
}

export interface GlanceState {
	workspace: {
		name: string;
		path: string;
	};
	git: GitSnapshot;
	providers: {
		availableCount: number;
	};
	model: {
		id?: string;
		provider?: string;
		displayName?: string;
		thinking: string;
	};
	context: {
		tokens: number | null;
		window: number;
		percent: number | null;
	};
	usage: UsageTotals;
	throughput: {
		lastRun: ModelSpeedMeasurement | null;
		currentRun: ModelSpeedMeasurement | null;
	};
	version: number;
}

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

interface SegmentPalette {
	fg: Rgb;
}

export interface GlancePalette {
	text: Rgb;
	dim: Rgb;
	warn: Rgb;
	error: Rgb;
	separator: Rgb;
	border: Rgb;
	title: Rgb;
	segments: Record<SegmentId, SegmentPalette>;
}

export interface IconSet extends Record<SegmentId, string> {}

interface SegmentDisplay {
	full?: string;
	compact?: string;
	minimal?: string;
}

export type SegmentTone = "normal" | "warning" | "error";

export interface SegmentData {
	/** Semantic emphasis, independent of the chosen display text. */
	tone?: SegmentTone;
	primary: string;
	secondary?: string;
	display?: SegmentDisplay;
}

export interface SegmentRenderContext {
	state: GlanceState;
	config: GlanceConfig;
	widthMode: WidthMode;
	icons: IconSet;
	showProvider: boolean;
}

export interface SegmentRenderResult {
	id: SegmentId;
	text: string;
	tone: SegmentTone;
}

export interface SegmentDefinition {
	id: SegmentId;
	label: string;
	iconSpacing?: Partial<Record<IconMode, number>>;
	collect(ctx: SegmentRenderContext): SegmentData | undefined;
}
