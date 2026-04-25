import { basename } from "node:path";

export function formatTokens(count: number | null | undefined): string {
	if (count === null || count === undefined || !Number.isFinite(count)) return "?";
	const abs = Math.abs(count);
	if (abs < 1000) return `${Math.round(count)}`;
	if (abs < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (abs < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (abs < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function formatCost(cost: number): string {
	if (!Number.isFinite(cost) || cost <= 0) return "$0.000";
	if (cost < 0.001) return "<$0.001";
	if (cost < 1) return `$${cost.toFixed(3)}`;
	if (cost < 10) return `$${cost.toFixed(2)}`;
	return `$${cost.toFixed(1)}`;
}

export function formatPercent(percent: number | null | undefined): string {
	if (percent === null || percent === undefined || !Number.isFinite(percent)) return "?";
	return percent >= 10 ? `${percent.toFixed(0)}%` : `${percent.toFixed(1)}%`;
}

export function shortenModel(modelId: string | undefined, customNames: Record<string, string> = {}): string {
	if (!modelId) return "no-model";
	for (const [pattern, name] of Object.entries(customNames)) {
		if (modelId.includes(pattern)) return name;
	}
	let id = modelId;
	id = id.replace(/^claude-/, "");
	id = id.replace(/^anthropic[/:]/, "");
	id = id.replace(/-20\d{6,8}$/, "");
	id = id.replace(/-latest$/, "");
	id = id.replace(/-/g, " ");
	id = id.replace(/\bsonnet\b/i, "Sonnet");
	id = id.replace(/\bopus\b/i, "Opus");
	id = id.replace(/\bhaiku\b/i, "Haiku");
	id = id.replace(/\bgpt\b/i, "GPT");
	id = id.replace(/\bglm\b/i, "GLM");
	return id.trim() || modelId;
}

export function displayDirectory(cwd: string): string {
	if (!cwd) return "?";
	return basename(cwd) || cwd;
}

export function stripControls(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}
