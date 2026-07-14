import { Plugin, WorkspaceLeaf } from "obsidian";
import { ConstellationsView, VIEW_TYPE_CONSTELLATIONS } from "./src/view";

export default class ConstellationsPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerView(
			VIEW_TYPE_CONSTELLATIONS,
			(leaf) => new ConstellationsView(leaf, this)
		);

		this.addRibbonIcon("sparkles", "Open Constellations", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-constellations-view",
			name: "Open Constellations view",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "recenter-constellations-view",
			name: "Recenter Constellations camera",
			checkCallback: (checking) => {
				const leaves = this.app.workspace.getLeavesOfType(
					VIEW_TYPE_CONSTELLATIONS
				);
				if (leaves.length === 0) return false;
				if (!checking) {
					for (const leaf of leaves) {
						const view = leaf.view;
						if (view instanceof ConstellationsView) view.resetCamera();
					}
				}
				return true;
			},
		});

		this.addCommand({
			id: "rebuild-constellations-view",
			name: "Rebuild Constellations view",
			checkCallback: (checking) => {
				const leaves = this.app.workspace.getLeavesOfType(
					VIEW_TYPE_CONSTELLATIONS
				);
				if (leaves.length === 0) return false;
				if (!checking) {
					for (const leaf of leaves) {
						const view = leaf.view;
						if (view instanceof ConstellationsView) view.rebuild();
					}
				}
				return true;
			},
		});
	}

	onunload(): void {
		// registerView leaves are torn down by Obsidian; nothing else to clean up.
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_CONSTELLATIONS);

		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_CONSTELLATIONS, active: true });
		}

		workspace.revealLeaf(leaf);
	}
}
