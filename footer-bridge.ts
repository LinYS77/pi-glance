import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { setProviderCount } from "./state.js";
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
		setProviderCount(this.getState(), this.footerData.getAvailableProviderCount());
	}
}
