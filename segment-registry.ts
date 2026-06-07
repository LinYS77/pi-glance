import {
	CONTEXT_DISPLAY_MODE_VALUES,
	CONTEXT_UNKNOWN_MODE_VALUES,
	GIT_SHA_MODE_VALUES,
	MODEL_THINKING_MODE_VALUES,
	PROVIDER_DISPLAY_MODE_VALUES,
	TOKENS_CACHE_MODE_VALUES,
	TOKENS_DISPLAY_MODE_VALUES,
} from "./config-options.js";
import { throughputSegmentFeature } from "./throughput-segment-feature.js";
import type { SegmentFeature, SegmentSettingDescriptor } from "./segment-feature.js";
import type { GlanceConfig, SegmentConfig, SegmentData, SegmentId, SegmentRenderContext } from "./types.js";

export { type SegmentId } from "./types.js";
export type { EditableSegmentSettingDescriptor, InfoSegmentSettingDescriptor, SegmentSettingDescriptor } from "./segment-feature.js";

export const SEGMENT_IDS = ["git", "cost", "throughput", "context", "tokens", "model"] as const satisfies readonly SegmentId[];

export type SegmentRegistryEntry = SegmentFeature;

type RegistryOwnedSegmentId = Exclude<SegmentId, "throughput">;

export interface SegmentCoverage {
	missing: SegmentId[];
	extra: string[];
}

const POLL_INTERVALS = [2000, 5000, 10000, 30000] as const;

const CONTEXT_DISPLAY_LABELS: Record<GlanceConfig["context"]["display"], string> = {
	"percent+tokens": "percent / tokens",
	percent: "percent",
	tokens: "tokens",
};

const TOKENS_DISPLAY_LABELS: Record<GlanceConfig["tokens"]["display"], string> = {
	"input-output": "input / output",
	total: "total",
};

function nextIn<T extends string | number>(current: T, values: readonly T[]): T {
	const index = values.indexOf(current);
	return values[(index + 1) % values.length] ?? values[0]!;
}

function nextNumber<T extends number>(current: number, values: readonly T[]): T {
	const index = values.indexOf(current as T);
	return values[(index + 1) % values.length] ?? values[0]!;
}

function onOff(value: boolean): string {
	return value ? "on" : "off";
}

function formatPolling(ms: number): string {
	if (ms % 1000 === 0) return `${ms / 1000}s`;
	return `${ms}ms`;
}

function contextDisplayLabel(mode: GlanceConfig["context"]["display"]): string {
	return CONTEXT_DISPLAY_LABELS[mode];
}

function tokensDisplayLabel(mode: GlanceConfig["tokens"]["display"]): string {
	return TOKENS_DISPLAY_LABELS[mode];
}

const SEGMENT_SETTINGS = {
	git: [
		{
			id: "git.dirtyMarker",
			label: "Dirty marker",
			hint: "Conflicts always stay visible.",
			kind: "toggle",
			value: (config) => onOff(config.git.showDirty),
			mutate: (config) => {
				config.git.showDirty = !config.git.showDirty;
			},
		},
		{
			id: "git.aheadBehind",
			label: "Ahead / behind",
			hint: "Show upstream counts.",
			kind: "toggle",
			value: (config) => onOff(config.git.showAheadBehind),
			mutate: (config) => {
				config.git.showAheadBehind = !config.git.showAheadBehind;
			},
		},
		{
			id: "git.sha",
			label: "SHA",
			hint: "Keep branches quiet unless enabled.",
			kind: "cycle",
			value: (config) => config.git.shaMode,
			mutate: (config) => {
				config.git.shaMode = nextIn(config.git.shaMode, GIT_SHA_MODE_VALUES);
			},
		},
		{
			id: "git.polling",
			label: "Polling",
			hint: "Check external Git changes.",
			kind: "cycle",
			value: (config) => formatPolling(config.git.pollIntervalMs),
			mutate: (config) => {
				config.git.pollIntervalMs = nextNumber(config.git.pollIntervalMs, POLL_INTERVALS);
			},
		},
	],
	context: [
		{
			id: "context.display",
			label: "Display",
			hint: "Choose percent, tokens, or both.",
			kind: "cycle",
			value: (config) => contextDisplayLabel(config.context.display),
			mutate: (config) => {
				config.context.display = nextIn(config.context.display, CONTEXT_DISPLAY_MODE_VALUES);
			},
		},
		{
			id: "context.unknown",
			label: "Unknown",
			hint: "Hide when usage is unknown.",
			kind: "cycle",
			value: (config) => config.context.unknown,
			mutate: (config) => {
				config.context.unknown = nextIn(config.context.unknown, CONTEXT_UNKNOWN_MODE_VALUES);
			},
		},
	],
	cost: [
		{
			id: "cost.hideZero",
			label: "Hide zero",
			hint: "Hide until cost is non-zero.",
			kind: "toggle",
			value: (config) => onOff(config.cost.hideZero),
			mutate: (config) => {
				config.cost.hideZero = !config.cost.hideZero;
			},
		},
		{
			id: "cost.display",
			label: "Display",
			hint: "Compact session cost.",
			kind: "info",
			value: () => "compact USD",
		},
	],
	tokens: [
		{
			id: "tokens.display",
			label: "Display",
			hint: "Choose input/output or total.",
			kind: "cycle",
			value: (config) => tokensDisplayLabel(config.tokens.display),
			mutate: (config) => {
				config.tokens.display = nextIn(config.tokens.display, TOKENS_DISPLAY_MODE_VALUES);
			},
		},
		{
			id: "tokens.cache",
			label: "Cache",
			hint: "Show or hide cache details.",
			kind: "cycle",
			value: (config) => config.tokens.cache,
			mutate: (config) => {
				config.tokens.cache = nextIn(config.tokens.cache, TOKENS_CACHE_MODE_VALUES);
			},
		},
	],
	model: [
		{
			id: "model.providerLabel",
			label: "Provider label",
			hint: "Show provider name.",
			kind: "cycle",
			value: (config) => config.display.showProvider,
			mutate: (config) => {
				config.display.showProvider = nextIn(config.display.showProvider, PROVIDER_DISPLAY_MODE_VALUES);
			},
		},
		{
			id: "model.thinkingLabel",
			label: "Thinking label",
			hint: "Show thinking level.",
			kind: "cycle",
			value: (config) => config.model.showThinking,
			mutate: (config) => {
				config.model.showThinking = nextIn(config.model.showThinking, MODEL_THINKING_MODE_VALUES);
			},
		},
	],
} as const satisfies Record<RegistryOwnedSegmentId, readonly SegmentSettingDescriptor[]>;

function formatTokens(count: number | null | undefined): string {
	if (count === null || count === undefined || !Number.isFinite(count)) return "?";
	const abs = Math.abs(count);
	if (abs < 1000) return `${Math.round(count)}`;
	if (abs < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (abs < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (abs < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function formatCost(cost: number): string {
	if (!Number.isFinite(cost) || cost <= 0) return "$0.000";
	if (cost < 0.001) return "<$0.001";
	if (cost < 1) return `$${cost.toFixed(3)}`;
	if (cost < 10) return `$${cost.toFixed(2)}`;
	return `$${cost.toFixed(1)}`;
}

function formatPercent(percent: number | null | undefined): string {
	if (percent === null || percent === undefined || !Number.isFinite(percent)) return "?";
	return percent >= 10 ? `${percent.toFixed(0)}%` : `${percent.toFixed(1)}%`;
}

function gitBranchLabel(ctx: SegmentRenderContext): string {
	const git = ctx.state.git;
	if (git.branch) {
		if (ctx.config.git.shaMode === "always" && git.sha) return `${git.branch} ${git.sha}`;
		return git.branch;
	}
	if (git.detached && git.sha && ctx.config.git.shaMode !== "off") return git.sha;
	return "HEAD";
}

function gitStatusMark(ctx: SegmentRenderContext): string {
	const status = ctx.state.git.status;
	if (status === "conflict") return ctx.config.icons === "nerd" ? "⚠" : "!";
	if (status === "dirty") return ctx.config.icons === "nerd" ? "●" : "*";
	return "";
}

function gitDetailParts(ctx: SegmentRenderContext): string[] {
	const git = ctx.state.git;
	const parts: string[] = [];
	const status = gitStatusMark(ctx);
	if (status && (ctx.config.git.showDirty || git.status === "conflict")) parts.push(status);
	if (ctx.config.git.showAheadBehind) {
		if (git.ahead > 0) parts.push(`↑${git.ahead}`);
		if (git.behind > 0) parts.push(`↓${git.behind}`);
	}
	return parts;
}

function collectGit(ctx: SegmentRenderContext): SegmentData | undefined {
	const git = ctx.state.git;
	if (!git.repo) return undefined;
	const branch = gitBranchLabel(ctx);
	const parts = gitDetailParts(ctx);
	const secondary = parts.join(" ") || undefined;
	const minimalStatus = git.status === "conflict" || ctx.config.git.showDirty ? gitStatusMark(ctx) : "";
	return {
		primary: branch,
		secondary,
		display: {
			minimal: [branch, minimalStatus].filter(Boolean).join(" "),
		},
	};
}

function contextTokenRatio(ctx: SegmentRenderContext): string {
	return `${formatTokens(ctx.state.context.tokens)}/${formatTokens(ctx.state.context.window)}`;
}

function contextIsUnknown(ctx: SegmentRenderContext): boolean {
	return ctx.state.context.percent === null && ctx.state.context.tokens === null;
}

function contextDisplayValue(ctx: SegmentRenderContext): string {
	const pct = formatPercent(ctx.state.context.percent);
	const ratio = contextTokenRatio(ctx);
	if (ctx.config.context.display === "percent") return pct;
	if (ctx.config.context.display === "tokens") return ratio;
	return `${pct} ${ratio}`;
}

function contextCompactValue(ctx: SegmentRenderContext): string {
	if (ctx.config.context.display === "tokens") return contextTokenRatio(ctx);
	return formatPercent(ctx.state.context.percent);
}

function collectContext(ctx: SegmentRenderContext): SegmentData | undefined {
	if (ctx.config.context.unknown === "hide" && contextIsUnknown(ctx)) return undefined;
	const primary = ctx.config.context.display === "tokens" ? contextTokenRatio(ctx) : formatPercent(ctx.state.context.percent);
	const secondary = ctx.config.context.display === "percent+tokens" ? contextTokenRatio(ctx) : undefined;
	const compact = contextCompactValue(ctx);
	return {
		primary,
		secondary,
		display: {
			full: contextDisplayValue(ctx),
			compact,
			minimal: compact,
		},
	};
}

function collectCost(ctx: SegmentRenderContext): SegmentData | undefined {
	if (ctx.config.cost.hideZero && (!Number.isFinite(ctx.state.usage.cost) || ctx.state.usage.cost <= 0)) return undefined;
	return {
		primary: formatCost(ctx.state.usage.cost),
	};
}

function shouldShowTokenCache(ctx: SegmentRenderContext): boolean {
	if (ctx.config.tokens.cache === "hide") return false;
	if (ctx.config.tokens.cache === "show") return true;
	return ctx.widthMode === "full";
}

function tokenCacheParts(ctx: SegmentRenderContext): string[] {
	if (!shouldShowTokenCache(ctx)) return [];
	const usage = ctx.state.usage;
	const parts: string[] = [];
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	return parts;
}

function tokenPrimary(ctx: SegmentRenderContext): string {
	const usage = ctx.state.usage;
	if (ctx.config.tokens.display === "total") return `total ${formatTokens(usage.input + usage.output)}`;
	return `↑${formatTokens(usage.input)} ↓${formatTokens(usage.output)}`;
}

function collectTokens(ctx: SegmentRenderContext): SegmentData | undefined {
	const primary = tokenPrimary(ctx);
	const cacheParts = tokenCacheParts(ctx);
	return {
		primary,
		secondary: cacheParts.join(" ") || undefined,
		display: {
			full: [primary, ...cacheParts].join(" "),
			compact: [primary, ...cacheParts].join(" "),
			minimal: [primary, ...cacheParts].join(" "),
		},
	};
}

function shouldShowThinking(ctx: SegmentRenderContext, thinking: string): boolean {
	if (ctx.config.model.showThinking === "never") return false;
	if (ctx.config.model.showThinking === "always") return Boolean(thinking);
	return thinking !== "off" && ctx.widthMode !== "minimal";
}

function collectModel(ctx: SegmentRenderContext): SegmentData | undefined {
	let model = ctx.state.model.displayName || ctx.state.model.id || "no-model";
	if (ctx.showProvider && ctx.state.model.provider) {
		model = `${ctx.state.model.provider}/${model}`;
	}
	const thinking = ctx.state.model.thinking || "off";
	const visibleThinking = shouldShowThinking(ctx, thinking) ? thinking : "";
	return {
		primary: model,
		secondary: visibleThinking || undefined,
		display: {
			full: visibleThinking ? `${model} ${visibleThinking}` : model,
			compact: visibleThinking ? `${model} ${visibleThinking}` : model,
			minimal: visibleThinking ? `${model} ${visibleThinking}` : model,
		},
	};
}

export const SEGMENT_REGISTRY = [
	{
		id: "git",
		label: "Git",
		defaultEnabled: true,
		settings: SEGMENT_SETTINGS.git,
		collect: collectGit,
	},
	{
		id: "cost",
		label: "Cost",
		defaultEnabled: true,
		settings: SEGMENT_SETTINGS.cost,
		collect: collectCost,
	},
	throughputSegmentFeature,
	{
		id: "context",
		label: "Context",
		defaultEnabled: true,
		settings: SEGMENT_SETTINGS.context,
		collect: collectContext,
	},
	{
		id: "tokens",
		label: "Tokens",
		defaultEnabled: false,
		settings: SEGMENT_SETTINGS.tokens,
		collect: collectTokens,
	},
	{
		id: "model",
		label: "Model",
		defaultEnabled: true,
		settings: SEGMENT_SETTINGS.model,
		collect: collectModel,
	},
] as const satisfies readonly SegmentRegistryEntry[];

export const SEGMENT_BY_ID: ReadonlyMap<SegmentId, SegmentRegistryEntry> = new Map(
	SEGMENT_REGISTRY.map((segment) => [segment.id, segment]),
);

const SEGMENT_ID_SET: ReadonlySet<string> = new Set(SEGMENT_IDS);

export function defaultSegmentConfigs(): SegmentConfig[] {
	return SEGMENT_REGISTRY.map((segment) => ({ id: segment.id, enabled: segment.defaultEnabled }));
}

export function isSegmentId(value: unknown): value is SegmentId {
	return typeof value === "string" && SEGMENT_ID_SET.has(value);
}

export function segmentLabel(id: SegmentId): string {
	return SEGMENT_BY_ID.get(id)?.label ?? id;
}

export function segmentRecordCoverage(record: Record<string, unknown>): SegmentCoverage {
	const keys = Object.keys(record);
	const keySet = new Set(keys);
	return {
		missing: SEGMENT_IDS.filter((id) => !keySet.has(id)),
		extra: keys.filter((key) => !isSegmentId(key)),
	};
}

export function getSegmentSettings(id: SegmentId): readonly SegmentSettingDescriptor[] {
	return SEGMENT_BY_ID.get(id)?.settings ?? [];
}
