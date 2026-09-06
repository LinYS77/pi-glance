import { MODEL_THINKING_MODE_VALUES, PROVIDER_DISPLAY_MODE_VALUES, nextOption } from "../config/options.js";
import type { SegmentFeature } from "./feature.js";
import type { GlanceConfig, SegmentData, SegmentRenderContext } from "../types.js";

function shouldShowThinking(ctx: SegmentRenderContext, thinking: string): boolean {
	if (ctx.config.model.showThinking === "never") return false;
	if (ctx.config.model.showThinking === "always") return Boolean(thinking);
	return thinking !== "off" && ctx.widthMode === "full";
}

function withoutProviderPrefix(name: string, provider: string | undefined): string {
	if (!provider) return name;
	const prefix = `${provider}-`;
	return name.length > prefix.length && name.toLowerCase().startsWith(prefix.toLowerCase()) ? name.slice(prefix.length) : name;
}

function collectModel(ctx: SegmentRenderContext): SegmentData | undefined {
	const modelId = ctx.state.model.id;
	const originalName = ctx.state.model.displayName || modelId || "no-model";
	const hasCustomName = Boolean(modelId && Object.keys(ctx.config.model.customNames).some(pattern => modelId.includes(pattern)));
	const shortName = hasCustomName ? originalName : withoutProviderPrefix(originalName, ctx.state.model.provider);
	const name = ctx.widthMode === "minimal" ? shortName : originalName;
	let provider = ctx.showProvider && ctx.state.model.provider ? `${ctx.state.model.provider}/` : "";
	const thinking = ctx.state.model.thinking || "off";
	const visibleThinking = shouldShowThinking(ctx, thinking) ? thinking : undefined;
	let suffix = visibleThinking ? ` ${visibleThinking}` : "";
	const model = `${provider}${name}`;
	const alternatives: string[] = [];
	if (provider && ctx.config.display.showProvider === "auto") {
		provider = "";
		alternatives.push(`${name}${suffix}`);
	}
	if (suffix && ctx.config.model.showThinking === "auto") {
		suffix = "";
		alternatives.push(`${provider}${name}`);
	}
	if (shortName !== name) alternatives.push(`${provider}${shortName}${suffix}`);
	return {
		primary: model,
		secondary: visibleThinking,
		fit: {
			alternatives,
			name: { prefix: provider, value: shortName, suffix },
		},
	};
}

export const modelSegmentFeature = {
	id: "model",
	label: "Model",
	defaultEnabled: true,
	settings: [
		{
			id: "model.providerLabel",
			label: "Provider label",
			hint: "Show provider name.",
			kind: "cycle",
			value: (config: GlanceConfig) => config.display.showProvider,
			mutate: (config: GlanceConfig) => {
				config.display.showProvider = nextOption(config.display.showProvider, PROVIDER_DISPLAY_MODE_VALUES);
			},
		},
		{
			id: "model.thinkingLabel",
			label: "Thinking label",
			hint: "Show thinking level.",
			kind: "cycle",
			value: (config: GlanceConfig) => config.model.showThinking,
			mutate: (config: GlanceConfig) => {
				config.model.showThinking = nextOption(config.model.showThinking, MODEL_THINKING_MODE_VALUES);
			},
		},
	],
	collect: collectModel,
} as const satisfies SegmentFeature;
