import type { ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import type { GlanceState } from "./types.js";

export class GlanceFooterBridge implements Component {
	private unsubscribeBranch?: () => void;

	constructor(
		private readonly tui: TUI,
		private readonly getState: () => GlanceState,
		private readonly footerData: ReadonlyFooterDataProvider,
	) {
		this.sync();
		this.unsubscribeBranch = footerData.onBranchChange(() => {
			this.sync();
			this.tui.requestRender();
		});
	}

	dispose(): void {
		this.unsubscribeBranch?.();
		this.unsubscribeBranch = undefined;
	}

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

		const branch = this.footerData.getGitBranch();
		if (state.git.branch !== branch) {
			state.git.branch = branch;
			changed = true;
		}

		const providerCount = this.footerData.getAvailableProviderCount();
		if (state.providers.availableCount !== providerCount) {
			state.providers.availableCount = providerCount;
			changed = true;
		}

		if (changed) state.version++;
	}
}
