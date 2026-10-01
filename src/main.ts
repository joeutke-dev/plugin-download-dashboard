import { Notice, Plugin } from "obsidian";
import { DashboardView, VIEW_TYPE } from "./view";
import { SettingsTab } from "./settingsTab";
import { RateLimitError, fetchCommunityPlugins, fetchPluginStats, fetchReleases } from "./api";
import { appendSnapshot, snapshotFromStatEntry } from "./model";
import {
	CommunityPlugin,
	DEFAULT_DATA,
	DEFAULT_SETTINGS,
	PluginData,
	PluginStats,
	Settings,
	Snapshot,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_TTL_MS = DAY_MS; // community list refetched at most daily

export default class PluginDownloadDashboard extends Plugin {
	data!: PluginData;
	/** In-memory cache of the big stats JSON for the current session. */
	private statsCache: PluginStats | null = null;

	async onload(): Promise<void> {
		await this.loadDataMerged();

		this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
		this.addRibbonIcon("bar-chart-3", "Plugin Download Dashboard", () => this.toggleView());
		this.addCommand({
			id: "open-dashboard",
			name: "Open Plugin Download Dashboard",
			callback: () => this.activateView(),
		});
		this.addSettingTab(new SettingsTab(this.app, this));

		// Once-a-day background refresh: run shortly after startup if due, then
		// re-check hourly so a long-running Obsidian session stays current even
		// if the pane is never opened.
		this.app.workspace.onLayoutReady(() => void this.maybeDailyRefresh());
		this.registerInterval(
			window.setInterval(() => void this.maybeDailyRefresh(), 60 * 60 * 1000)
		);
	}

	/** Run the watchlist refresh if the user hasn't refreshed in the last day. */
	private async maybeDailyRefresh(): Promise<void> {
		if (!this.data.settings.dailyAutoRefresh) return;
		if (this.data.watchlist.length === 0) return;
		if (Date.now() - this.data.lastRefresh < DAY_MS) return;
		await this.refreshWatchlist(true);
	}

	// ---- persistence -------------------------------------------------------

	private async loadDataMerged(): Promise<void> {
		// `watchlist` tolerates the pre-themes-removal shape ({ plugins: [...] }).
		const raw = ((await this.loadData()) ?? {}) as {
			watchlist?: string[] | { plugins?: string[] };
			snapshots?: PluginData["snapshots"];
			releaseDates?: PluginData["releaseDates"];
			listCache?: PluginData["listCache"];
			lastRefresh?: number;
			settings?: Partial<Settings>;
		};
		const watchlist = Array.isArray(raw.watchlist)
			? raw.watchlist
			: raw.watchlist?.plugins ?? [];
		this.data = {
			...DEFAULT_DATA,
			watchlist,
			snapshots: raw.snapshots ?? {},
			releaseDates: raw.releaseDates ?? {},
			listCache: raw.listCache ?? null,
			lastRefresh: raw.lastRefresh ?? 0,
			settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
		};

		// Invariant: snapshots exist only for currently-watched plugins. Prune
		// orphans (e.g. a stale key from an older format, or data left if a
		// plugin was removed from the watchlist outside the normal flow).
		for (const key of Object.keys(this.data.snapshots)) {
			if (!this.data.watchlist.includes(key)) delete this.data.snapshots[key];
		}
	}

	async persist(): Promise<void> {
		await this.saveData(this.data);
	}

	// ---- view activation ---------------------------------------------------

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			const right = workspace.getRightLeaf(false);
			if (!right) return;
			leaf = right;
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	/** Ribbon action: open+reveal the pane, or close it if it's already open. */
	async toggleView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		if (leaves.length > 0) {
			for (const leaf of leaves) leaf.detach();
			return;
		}
		await this.activateView();
	}

	// ---- lookups -----------------------------------------------------------

	findPlugin(id: string): CommunityPlugin | null {
		return this.data.listCache?.plugins.find((p) => p.id === id) ?? null;
	}

	snapshotsFor(id: string): Snapshot[] {
		return this.data.snapshots[id] ?? [];
	}

	isWatched(id: string): boolean {
		return this.data.watchlist.includes(id);
	}

	/** The community stats JSON for the session (fetched once, reused). Pass
	 *  force to re-pull — used by explicit refreshes so a watched plugin can
	 *  pick up a newer `updated` stamp. */
	async getStats(force = false): Promise<PluginStats> {
		if (!force && this.statsCache) return this.statsCache;
		this.statsCache = await fetchPluginStats();
		return this.statsCache;
	}

	/** Whether the session stats JSON has been loaded yet (for Browse totals). */
	hasStats(): boolean {
		return this.statsCache !== null;
	}

	/** Total downloads for a plugin from the loaded stats, or null if not loaded. */
	cachedTotal(id: string): number | null {
		return this.statsCache?.[id]?.downloads ?? null;
	}

	/** An ephemeral snapshot built straight from the current stats JSON — used
	 *  to render the Browse dashboard on the fly WITHOUT persisting anything. */
	async liveSnapshot(id: string): Promise<Snapshot | null> {
		const stats = await this.getStats(false);
		const entry = stats[id];
		return entry ? snapshotFromStatEntry(entry) : null;
	}

	/** Start tracking a plugin: add it to the watchlist and capture a first
	 *  stored snapshot (from here on, refreshes accumulate history). */
	async watch(id: string, repo: string): Promise<void> {
		if (!this.isWatched(id)) this.data.watchlist.push(id);
		const snap = await this.liveSnapshot(id);
		if (snap) {
			this.appendItemSnapshot(id, snap);
			if (repo) {
				try {
					await this.ensureReleaseDates(repo, Object.keys(snap.releases));
				} catch {
					/* dates optional */
				}
			}
		}
		await this.persist();
	}

	/** Stop tracking a plugin and clear its stored snapshot history. */
	async unwatch(id: string): Promise<void> {
		const i = this.data.watchlist.indexOf(id);
		if (i >= 0) this.data.watchlist.splice(i, 1);
		delete this.data.snapshots[id];
		await this.persist();
	}

	// ---- community list ----------------------------------------------------

	async ensureLists(force = false): Promise<void> {
		const cache = this.data.listCache;
		if (!force && cache && Date.now() - cache.fetchedAt < LIST_TTL_MS) return;
		try {
			const plugins = await fetchCommunityPlugins();
			this.data.listCache = { plugins, fetchedAt: Date.now() };
			await this.persist();
		} catch (e) {
			// Keep any stale cache; only surface the error when we have nothing.
			if (!cache) new Notice(`Plugin Download Dashboard: could not load the community list — ${msg(e)}`);
		}
	}

	// ---- snapshots ---------------------------------------------------------

	/** Append a snapshot for one plugin; returns true if anything was stored. */
	private appendItemSnapshot(id: string, snap: Snapshot): boolean {
		const hist = this.data.snapshots[id] ?? [];
		const next = appendSnapshot(hist, snap, this.data.settings.maxSnapshots);
		if (next === hist) return false; // deduped — nothing changed
		this.data.snapshots[id] = next;
		return true;
	}

	/** Refresh every watchlisted plugin. `silent` suppresses the success Notice
	 *  (used on auto-refresh when the view opens). */
	async refreshWatchlist(silent = false): Promise<void> {
		const ids = this.data.watchlist;
		if (ids.length === 0) return;
		let changed = false;

		try {
			const stats = await this.getStats(true);
			for (const id of ids) {
				const entry = stats[id];
				if (!entry) continue;
				const snap = snapshotFromStatEntry(entry);
				if (this.appendItemSnapshot(id, snap)) changed = true;
				// Best-effort: fetch release dates for the time axis (skips when
				// already cached for every version — no wasted GitHub calls).
				const repo = this.findPlugin(id)?.repo;
				if (repo) {
					try {
						await this.ensureReleaseDates(repo, Object.keys(snap.releases));
					} catch {
						/* dates optional */
					}
				}
			}
		} catch (e) {
			if (!silent) new Notice(`Plugin Download Dashboard: ${msg(e)}`);
		}

		this.data.lastRefresh = Date.now();
		await this.persist();
		if (!silent) {
			new Notice(`Plugin Download Dashboard: refreshed ${ids.length} watched plugin${ids.length === 1 ? "" : "s"}.`);
		}
	}

	/** Refresh a single watched plugin (explicit user action — fetches fresh). */
	async refreshItem(id: string, repo: string): Promise<void> {
		const stats = await this.getStats(true);
		const entry = stats[id];
		if (!entry) {
			new Notice("Plugin Download Dashboard: no download data available for this plugin.");
			return;
		}
		const snap = snapshotFromStatEntry(entry);
		if (repo) {
			try {
				await this.ensureReleaseDates(repo, Object.keys(snap.releases));
			} catch (e) {
				new Notice(`Plugin Download Dashboard: release dates unavailable — ${msg(e)}`);
			}
		}
		const changed = this.appendItemSnapshot(id, snap);
		await this.persist();
		new Notice(
			changed
				? "Plugin Download Dashboard: snapshot captured."
				: "Plugin Download Dashboard: no change since the last snapshot."
		);
	}

	/** Cache a repo's version->publish-date map from the GitHub Releases API.
	 *  Skips the network call when every requested version is already cached. */
	async ensureReleaseDates(repo: string, versions?: string[]): Promise<void> {
		if (!repo) return;
		const have = this.data.releaseDates[repo];
		const missing = versions ? versions.some((v) => !have || !(v in have)) : !have;
		if (have && !missing) return;

		const releases = await fetchReleases(repo, this.data.settings.githubToken || undefined);
		const dates: Record<string, string> = {};
		for (const r of releases) addDate(dates, r.tag_name, r.published_at);
		this.data.releaseDates[repo] = dates;
	}
}

/** Record a tag's publish date under both its raw form and its no-"v" form, so
 *  stats version keys (usually "1.2.3") match tags like "v1.2.3". */
function addDate(dates: Record<string, string>, tag: string, publishedAt: string): void {
	if (!publishedAt) return;
	dates[tag] = publishedAt;
	const noV = tag.replace(/^v/i, "");
	if (!(noV in dates)) dates[noV] = publishedAt;
}

function msg(e: unknown): string {
	if (e instanceof RateLimitError) return e.message;
	return e instanceof Error ? e.message : String(e);
}
