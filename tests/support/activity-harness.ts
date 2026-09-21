import type { CustomEditor } from "@earendil-works/pi-coding-agent";

export function nativeActivity(kind: "working" | "compaction" | "branchSummary" | "retry", text = `DEMO ${kind}`) {
	return { kind, renderInBorder: () => text, renderSpinnerInBorder: () => "◌",
		dispose() { throw new Error("Pi owns this indicator"); }, stop() { throw new Error("Pi owns its clock"); } } as unknown as NonNullable<Parameters<CustomEditor["setWorkingStatusIndicator"]>[0]>;
}

export function animationTime() {
	let now = 0;
	let last = () => {};
	const pending = new Map<() => void, number>();
	return {
		now: () => now,
		pending: () => pending.size,
		nextDelay: () => Math.min(...pending.values()) - now,
		stale: () => last,
		schedule(callback: () => void, delay: number) {
			last = callback; pending.set(callback, now + delay);
			return () => { pending.delete(callback); };
		},
		advance(ms: number) {
			now += ms;
			for (const [callback, due] of [...pending]) if (due <= now) { pending.delete(callback); callback(); }
		},
	};
}
