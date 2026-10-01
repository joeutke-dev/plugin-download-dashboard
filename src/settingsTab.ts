import { App, PluginSettingTab, Setting } from "obsidian";
import type PluginDownloadDashboard from "./main";

export class SettingsTab extends PluginSettingTab {
	plugin: PluginDownloadDashboard;

	constructor(app: App, plugin: PluginDownloadDashboard) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("GitHub personal access token")
			.setDesc(
				"Optional. Only used to read release publish dates from the GitHub API (the time axis for the download charts). Raises the rate limit from 60 to 5,000 requests/hour — set one if you watchlist or browse many plugins and hit the limit. A classic token with no scopes is enough; it only reads public data."
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("ghp_…")
					.setValue(this.plugin.data.settings.githubToken)
					.onChange(async (value) => {
						this.plugin.data.settings.githubToken = value.trim();
						await this.plugin.persist();
					});
			});

		new Setting(containerEl)
			.setName("Auto-refresh on open")
			.setDesc(
				"Capture a fresh snapshot of every watchlisted item each time the dashboard opens. Deduplicated — nothing is stored if the source hasn't changed since the last capture."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.data.settings.autoRefreshOnOpen)
					.onChange(async (value) => {
						this.plugin.data.settings.autoRefreshOnOpen = value;
						await this.plugin.persist();
					})
			);

		new Setting(containerEl)
			.setName("Daily background refresh")
			.setDesc(
				"Once a day, refresh watchlisted plugins in the background even if the dashboard isn't open — but only if you haven't already refreshed within the last 24 hours."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.data.settings.dailyAutoRefresh)
					.onChange(async (value) => {
						this.plugin.data.settings.dailyAutoRefresh = value;
						await this.plugin.persist();
					})
			);

		new Setting(containerEl)
			.setName("Max snapshots per item")
			.setDesc("Oldest snapshots are trimmed once a watched item exceeds this many.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.data.settings.maxSnapshots))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!Number.isNaN(n) && n > 0) {
							this.plugin.data.settings.maxSnapshots = n;
							await this.plugin.persist();
						}
					})
			);
	}
}
