export type SegmentId = "git.branch" | "model" | "context" | "tokens" | "cost";
export type GlanceThemeName = "light" | "dark";
export type IconMode = "nerd" | "plain";
export type WidthMode = "full" | "compact" | "minimal";

export interface SegmentConfig {
	id: SegmentId;
	enabled: boolean;
	priority: number;
}

export interface DisplayConfig {
	adaptive: boolean;
	showProvider: "auto" | "always" | "never";
}

export interface EditorConfig {
	minContentRows: number;
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
}

export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface GlanceState {
	workspace: {
		name: string;
		path: string;
	};
	git: {
		branch: string | null;
	};
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

export interface SegmentPalette {
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

export interface SegmentRenderContext {
	state: GlanceState;
	config: GlanceConfig;
	widthMode: WidthMode;
	icons: IconSet;
	palette: GlancePalette;
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
	render(ctx: SegmentRenderContext): SegmentRenderResult | undefined;
}
