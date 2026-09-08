import type { GitSnapshot, GitStatus } from "../types.js";

interface GitCounts {
	staged: number;
	unstaged: number;
	untracked: number;
	conflicts: number;
}

interface BranchInfo {
	branch: string | null;
	detached: boolean;
	sha: string | null;
	upstream: string | null;
	ahead: number;
	behind: number;
}

export function emptyGitSnapshot(status: GitStatus = "unknown", now = Date.now()): GitSnapshot {
	return {
		repo: false,
		branch: null,
		detached: false,
		sha: null,
		upstream: null,
		ahead: 0,
		behind: 0,
		staged: 0,
		unstaged: 0,
		untracked: 0,
		conflicts: 0,
		dirty: false,
		status,
		updatedAt: now,
	};
}

function shortSha(oid: string | null): string | null {
	if (!oid || oid === "(initial)") return null;
	return oid.slice(0, 7);
}

function isChangedStatus(status: string | undefined): boolean {
	return !!status && status !== ".";
}

function addStatusPair(pair: string, counts: GitCounts): void {
	if (isChangedStatus(pair[0])) counts.staged++;
	if (isChangedStatus(pair[1])) counts.unstaged++;
}

function emptyBranchInfo(): BranchInfo {
	return {
		branch: null,
		detached: false,
		sha: null,
		upstream: null,
		ahead: 0,
		behind: 0,
	};
}

function parseBranchHeader(line: string, info: BranchInfo): void {
	if (line.startsWith("# branch.oid ")) {
		info.sha = shortSha(line.slice("# branch.oid ".length).trim());
		return;
	}
	if (line.startsWith("# branch.head ")) {
		const head = line.slice("# branch.head ".length).trim();
		info.detached = head === "(detached)";
		info.branch = info.detached ? null : head;
		return;
	}
	if (line.startsWith("# branch.upstream ")) {
		info.upstream = line.slice("# branch.upstream ".length).trim() || null;
		return;
	}
	if (line.startsWith("# branch.ab ")) {
		const match = line.match(/\+([0-9]+)\s+-([0-9]+)/);
		if (!match) return;
		info.ahead = Number.parseInt(match[1]!, 10);
		info.behind = Number.parseInt(match[2]!, 10);
	}
}

function parseStatusRecord(line: string, counts: GitCounts): void {
	if (line.startsWith("1 ") || line.startsWith("2 ")) {
		addStatusPair(line.slice(2, 4), counts);
		return;
	}
	if (line.startsWith("? ")) {
		counts.untracked++;
		return;
	}
	if (line.startsWith("u ")) {
		counts.conflicts++;
	}
}

function snapshotStatus(counts: GitCounts): GitStatus {
	if (counts.conflicts > 0) return "conflict";
	if (counts.staged > 0 || counts.unstaged > 0 || counts.untracked > 0) return "dirty";
	return "clean";
}

/** Numstat rename records have two extra NUL paths; neither is a statistics row. */
export function parseGitDiffStat(output: string): { additions: number; deletions: number } | undefined {
	const fields = output.split("\0");
	let additions = 0, deletions = 0;
	for (let i = 0; i < fields.length; i++) {
		const field = fields[i]!;
		if (!field && i === fields.length - 1) continue;
		const row = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(field);
		if (!row || row[1] === "-" || row[2] === "-") return undefined;
		additions += Number(row[1]);
		deletions += Number(row[2]);
		if (row[3] === "") {
			if (!fields[i + 1] || !fields[i + 2]) return undefined;
			i += 2;
		}
	}
	return { additions, deletions };
}

export function parseGitStatus(output: string, now = Date.now()): GitSnapshot {
	const branch = emptyBranchInfo();
	const counts: GitCounts = { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 };

	const records = output.includes("\0") ? output.split("\0") : output.split(/\r?\n/);
	let files = 0;
	for (let index = 0; index < records.length; index++) {
		const line = records[index]!;
		if (!line) continue;
		if (line.startsWith("# ")) parseBranchHeader(line, branch);
		else {
			parseStatusRecord(line, counts);
			// Porcelain emits one record per current path, even with both X and Y
			// modified. A rename's extra NUL field is its old path, not another file.
			if (/^[12u?] /.test(line)) files++;
			if (line.startsWith("2 ") && output.includes("\0")) index++;
		}
	}

	const status = snapshotStatus(counts);
	return {
		repo: true,
		branch: branch.branch,
		detached: branch.detached,
		sha: branch.sha,
		upstream: branch.upstream,
		ahead: branch.ahead,
		behind: branch.behind,
		staged: counts.staged,
		unstaged: counts.unstaged,
		untracked: counts.untracked,
		conflicts: counts.conflicts,
		dirty: status !== "clean",
		status,
		summary: { files, additions: status === "clean" ? 0 : null, deletions: status === "clean" ? 0 : null },
		updatedAt: now,
	};
}

