import type { UsageTotals } from "../types.js";

interface UsageInputs {
	totalTokens?: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: Omit<Partial<UsageTotals>, "cost"> & { total?: number };
}

export interface StateMessageInputs {
	role?: string;
	stopReason?: string;
	responseId?: unknown;
	toolCallId?: unknown;
	usage?: UsageInputs;
}

export interface StateSessionEntry {
	type?: string;
	id?: unknown;
	parentId?: string | null;
	message?: StateMessageInputs;
	usage?: UsageInputs;
}

interface PersistedCursor {
	getLeafId(): string | null;
	getEntry(id: string): StateSessionEntry | undefined;
}

function emptyTotals(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function totalsFrom(usage: UsageInputs | undefined): UsageTotals {
	const cost = usage?.cost;
	return {
		input: usage?.input ?? 0,
		output: usage?.output ?? 0,
		cacheRead: usage?.cacheRead ?? 0,
		cacheWrite: usage?.cacheWrite ?? 0,
		cost: Number.isFinite(cost?.total) ? cost?.total ?? 0
			: (cost?.input ?? 0) + (cost?.output ?? 0) + (cost?.cacheRead ?? 0) + (cost?.cacheWrite ?? 0),
	};
}

function add(total: UsageTotals, delta: UsageTotals): void {
	total.input += delta.input;
	total.output += delta.output;
	total.cacheRead += delta.cacheRead;
	total.cacheWrite += delta.cacheWrite;
	total.cost += delta.cost;
}

function billedMessage(message: StateMessageInputs): boolean {
	return message.role === "assistant" || message.role === "toolResult";
}

function billedBoundary(entry: StateSessionEntry): boolean {
	return entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary";
}

function messageKey(message: StateMessageInputs): string | undefined {
	if (message.role === "assistant" && typeof message.responseId === "string" && message.responseId) return `assistant:${message.responseId}`;
	if (message.role === "toolResult" && typeof message.toolCallId === "string" && message.toolCallId) return `toolResult:${message.toolCallId}`;
	return undefined;
}

function entryKey(entry: StateSessionEntry): string | undefined {
	return typeof entry.id === "string" && entry.id ? `${entry.type ?? "entry"}:${entry.id}` : undefined;
}

/** Whole-session bill: persisted entries on every branch, plus lifecycle deltas not yet persisted. */
export class BilledSessionLedger {
	private readonly seenEntries = new Set<string>();
	private readonly appliedKeys = new Set<string>();
	private readonly appliedObjects = new WeakSet<object>();
	private current = emptyTotals();

	get totals(): Readonly<UsageTotals> { return this.current; }

	rebuild(entries: readonly StateSessionEntry[]): Readonly<UsageTotals> {
		const total = emptyTotals();
		this.seenEntries.clear();
		for (const entry of entries) {
			if (typeof entry.id === "string") this.seenEntries.add(entry.id);
			if (entry.type === "message" && entry.message && billedMessage(entry.message)) {
				this.claim(entry.message, messageKey(entry.message));
				add(total, totalsFrom(entry.message.usage));
			} else if (billedBoundary(entry)) {
				this.claim(entry, entryKey(entry));
				add(total, totalsFrom(entry.usage));
			}
		}
		// All persisted entries count, irrespective of lifecycle deduplication.
		// Keep prior claims so notifications received late cannot replay old deltas.
		this.current = total;
		return total;
	}

	recordMessage(message: StateMessageInputs): boolean {
		return billedMessage(message) && this.record(message, messageKey(message), message.usage);
	}

	recordBoundary(entry: StateSessionEntry): boolean {
		return billedBoundary(entry) && this.record(entry, entryKey(entry), entry.usage);
	}

	advance(cursor: PersistedCursor): boolean {
		let changed = false;
		let id = cursor.getLeafId();
		// Ordinary messages arrive as event deltas. Summaries and usage may be
		// persisted without such an event. Read only unseen ancestors of the leaf.
		while (id && !this.seenEntries.has(id)) {
			const entry = cursor.getEntry(id);
			if (!entry) break;
			this.seenEntries.add(id);
			changed = this.recordBoundary(entry) || changed;
			id = entry.parentId ?? null;
		}
		return changed;
	}

	private claim(source: object, key: string | undefined): boolean {
		if (key) {
			if (this.appliedKeys.has(key)) return false;
			this.appliedKeys.add(key);
		} else {
			if (this.appliedObjects.has(source)) return false;
			this.appliedObjects.add(source);
		}
		return true;
	}

	private record(source: object, key: string | undefined, usage: UsageInputs | undefined): boolean {
		if (!usage) return false;
		const delta = totalsFrom(usage);
		if (delta.input === 0 && delta.output === 0 && delta.cacheRead === 0 && delta.cacheWrite === 0 && delta.cost === 0) return false;
		if (!this.claim(source, key)) return false;
		const next = { ...this.current };
		add(next, delta);
		this.current = next;
		return true;
	}
}
