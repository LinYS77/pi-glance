import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { GlanceState } from "./types.js";

export class GlanceFooterBridge implements Component {
	constructor(
		private readonly getState: () => GlanceState,
		private readonly footerData: ReadonlyFooterDataProvider,
	) {
		this.sync();
	}

	dispose(): void {}

	invalidate(): void {
		this.sync();
	}

	render(_width: number): string[] {
		this.sync();
		return [];
	}

	private sync(): void {
		const state = this.getState();
		let changed = false;

		const providerCount = this.footerData.getAvailableProviderCount();
		if (state.providers.availableCount !== providerCount) {
			state.providers.availableCount = providerCount;
			changed = true;
		}

		if (changed) state.version++;
	}
}
