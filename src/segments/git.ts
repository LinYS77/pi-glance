import { choiceSetting, toggleSetting } from "../config/settings.js";
import type { SegmentFeature } from "./feature.js";
import type { SegmentData, SegmentRenderContext } from "../types.js";

const POLL_INTERVALS = [2000, 5000, 10000, 30000] as const;

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

function collectGit(ctx: SegmentRenderContext): SegmentData | undefined {
	const git = ctx.state.git;
	if (!git.repo) return undefined;
	const branch = gitBranchLabel(ctx);
	const showMark = git.status === "conflict" || ctx.config.git.changes !== "hidden";
	const mark = [showMark ? gitStatusMark(ctx) : "", git.stale ? "?" : ""].filter(Boolean).join(" ");
	const core = [branch, mark].filter(Boolean).join(" ");
	const summary = ctx.config.git.changes === "summary" && git.status !== "clean" && !git.stale ? git.summary : undefined;
	const fileLabel = summary?.files ? `Δ${summary.files}` : "";
	const compact = fileLabel
		? [branch, git.status === "conflict" ? mark : "", fileLabel].filter(Boolean).join(" ")
		: core;
	const full = [compact];
	if (fileLabel && summary && summary.additions !== null && summary.deletions !== null) {
		if (summary.additions) full.push(`+${summary.additions}`);
		if (summary.deletions) full.push(`−${summary.deletions}`);
	}
	const upstream: string[] = [];
	if (ctx.config.git.showAheadBehind && !git.stale) {
		if (git.ahead) upstream.push(`↑${git.ahead}`);
		if (git.behind) upstream.push(`↓${git.behind}`);
	}
	full.push(...upstream);
	let detailFallbacks: string[] | undefined;
	if (fileLabel && ctx.widthMode !== "minimal") {
		detailFallbacks = ctx.widthMode === "full"
			? [[compact, ...upstream].join(" "), [core, ...upstream].join(" ")]
			: [core];
	}
	return {
		primary: full.join(" "),
		display: { compact, minimal: core },
		detailFallbacks,
	};
}

export const gitSegmentFeature = {
	id: "git",
	label: "Git",
	defaultEnabled: true,
	settings: [
		choiceSetting(
			"git.changes",
			"Changes",
			"Show a marker or a compact change summary. Conflicts stay visible.",
			[
				{ value: "hidden", label: "Hidden" },
				{ value: "marker", label: "Marker" },
				{ value: "summary", label: "Summary" },
			],
			(c) => c.git.changes,
			(c, v) => {
				c.git.changes = v;
			},
		),
		toggleSetting(
			"git.aheadBehind",
			"Ahead / behind",
			"Show commits ahead of or behind the upstream branch.",
			(c) => c.git.showAheadBehind,
			(c, v) => {
				c.git.showAheadBehind = v;
			},
		),
		choiceSetting(
			"git.sha",
			"Commit ID",
			"Choose when to show the short commit ID.",
			[
				{ value: "off", label: "Hidden" },
				{ value: "detached", label: "When detached", hint: "Show when no branch is checked out." },
				{ value: "always", label: "Always" },
			],
			(c) => c.git.shaMode,
			(c, v) => {
				c.git.shaMode = v;
			},
		),
		toggleSetting(
			"git.fetch", "Auto fetch",
			"Refresh the upstream branch every 5 minutes. No sign-in prompts; failures retry later.",
			c => c.git.autoFetch,
			(c, value) => { c.git.autoFetch = value; },
		),
		choiceSetting(
			"git.polling",
			"Refresh interval",
			"How often to check Git changes made outside Pi.",
			POLL_INTERVALS.map((value) => ({ value, label: `${value / 1000} seconds` })),
			(c) => c.git.pollIntervalMs,
			(c, v) => {
				c.git.pollIntervalMs = v;
			},
			(value) => `${value / 1000} seconds`,
		),
	],
	collect: collectGit,
} as const satisfies SegmentFeature;
