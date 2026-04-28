export type SegmentId = "git" | "model" | "context" | "tokens" | "cost";
export type GlanceThemeName = "light" | "dark";
export type IconMode = "nerd" | "plain";
export type WidthMode = "full" | "compact" | "minimal";
export type GitStatus = "clean" | "dirty" | "conflict" | "unknown";
type GitShaMode = "auto" | "always" | "never";
type SegmentMetadataValue = string | number | boolean | null;
type SegmentMetadata = Record<string, SegmentMetadataValue>;

export interface SegmentConfig {
	id: SegmentId;
	enabled: boolean;
	priority: number;
}

interface DisplayConfig {
	adaptive: boolean;
	showProvider: "auto" | "always" | "never";
}

interface EditorConfig {
	minContentRows: number;
}

export interface GitConfig {
	showDirty: boolean;
	showAheadBehind: boolean;
	showSha: GitShaMode;
	timeoutMs: number;
	refreshDebounceMs: number;
	snapshotTtlMs: number;
}

export interface GlanceConfig {
	version: 2;
	enabled: boolean;
	theme: GlanceThemeName;
	icons: IconMode;
	editor: EditorConfig;
	display: DisplayConfig;
	segments: SegmentConfig[];
	model: {
		customNames: Record<string, string>;
	};
	git: GitConfig;
}

export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
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
	name: GlanceThemeName;
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

export interface SegmentData {
	primary: string;
	secondary?: string;
	metadata?: SegmentMetadata;
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
	priority: number;
}

export interface SegmentDefinition {
	id: SegmentId;
	label: string;
	defaultPriority: number;
	collect(ctx: SegmentRenderContext): SegmentData | undefined;
}
