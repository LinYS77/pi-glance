import { choiceSetting, toggleSetting, type SegmentFeature } from "./feature.js";
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
	const coreStatus = git.status === "conflict" || ctx.config.git.showDirty ? gitStatusMark(ctx) : "";
	const core = [branch, coreStatus].filter(Boolean).join(" ");
	return {
		primary: branch,
		secondary,
		display: {
			compact: core,
			minimal: core,
		},
	};
}

export const gitSegmentFeature = {
	id: "git",
	label: "Git",
	defaultEnabled: true,
	settings: [
		toggleSetting("git.dirtyMarker", "Uncommitted changes", "Mark a branch with uncommitted changes. Conflicts always stay visible.", c => c.git.showDirty, (c, v) => { c.git.showDirty = v; }),
		toggleSetting("git.aheadBehind", "Ahead / behind", "Show commits ahead of or behind the upstream branch.", c => c.git.showAheadBehind, (c, v) => { c.git.showAheadBehind = v; }),
		choiceSetting("git.sha", "Commit ID", "Choose when to show the short commit ID.", [
			{ value: "off", label: "Hidden" }, { value: "detached", label: "When detached", hint: "Show when no branch is checked out." }, { value: "always", label: "Always" },
		], c => c.git.shaMode, (c, v) => { c.git.shaMode = v; }),
		choiceSetting("git.polling", "Refresh interval", "How often to check Git changes made outside Pi.", POLL_INTERVALS.map(value => ({ value, label: `${value / 1000} seconds` })), c => c.git.pollIntervalMs, (c, v) => { c.git.pollIntervalMs = v; }, value => `${value / 1000} seconds`),
	],
	collect: collectGit,
} as const satisfies SegmentFeature;
