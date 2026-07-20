import { App, Modal, Notice, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type ConstellationsPlugin from "../main";

export const GITHUB_REPO = "NikShukrem/obsidian-constellations";
export const FIRST_PUBLISHED_VERSION = "0.1.0";

const ROLLBACK_ASSETS = ["manifest.json", "main.js", "styles.css"];

class ConfirmRollbackModal extends Modal {
	constructor(app: App, private version: string, private onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Roll back Constellations?" });
		contentEl.createEl("p", {
			text: `This downloads v${this.version} (the first version ever published) from GitHub and overwrites the installed plugin files. You'll need to reload Obsidian afterward.`,
		});
		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		buttons
			.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => this.close());
		const confirmBtn = buttons.createEl("button", {
			text: `Roll back to v${this.version}`,
			cls: "mod-warning",
		});
		confirmBtn.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ConstellationsSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ConstellationsPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Installed version")
			.setDesc(`v${this.plugin.manifest.version}`);

		new Setting(containerEl)
			.setName("Roll back to first published version")
			.setDesc(
				`Downloads v${FIRST_PUBLISHED_VERSION} — the very first version ever published — from GitHub and replaces the installed plugin files. Useful if a newer version misbehaves.`
			)
			.addButton((button) => {
				button
					.setButtonText(`Roll back to v${FIRST_PUBLISHED_VERSION}`)
					.setWarning()
					.onClick(() => {
						new ConfirmRollbackModal(this.app, FIRST_PUBLISHED_VERSION, () => {
							void this.runRollback(button);
						}).open();
					});
			});
	}

	private async runRollback(button: { setDisabled: (v: boolean) => unknown }): Promise<void> {
		button.setDisabled(true);
		const notice = new Notice(`Rolling back to v${FIRST_PUBLISHED_VERSION}…`, 0);
		try {
			await rollbackPluginFiles(this.plugin, FIRST_PUBLISHED_VERSION);
			notice.hide();
			new Notice(
				`Rolled back to v${FIRST_PUBLISHED_VERSION}. Reload Obsidian (or disable/re-enable the plugin) to finish.`,
				10000
			);
		} catch (err) {
			notice.hide();
			const message = err instanceof Error ? err.message : String(err);
			new Notice(`Rollback failed: ${message}`, 10000);
		} finally {
			button.setDisabled(false);
		}
	}
}

async function rollbackPluginFiles(plugin: ConstellationsPlugin, version: string): Promise<void> {
	const dir = plugin.manifest.dir;
	if (!dir) throw new Error("Could not resolve the plugin's install directory.");

	const downloads = await Promise.all(
		ROLLBACK_ASSETS.map(async (file) => {
			const url = `https://github.com/${GITHUB_REPO}/releases/download/${version}/${file}`;
			const response = await requestUrl({ url, throw: false });
			if (response.status !== 200) {
				throw new Error(`Failed to download ${file} (HTTP ${response.status}).`);
			}
			return { file, text: response.text };
		})
	);

	for (const { file, text } of downloads) {
		await plugin.app.vault.adapter.write(`${dir}/${file}`, text);
	}
}
