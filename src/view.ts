import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type PluginDownloadDashboard from "./main";
import type { CommunityPlugin, Snapshot } from "./types";
import { buildCombinedHistory, buildDonutData, buildGrowthSeries, buildReleaseTable } from "./model";
import { autoResize, purgeChart, renderDonut, renderLineChart } from "./charts";
import { ConfirmModal } from "./confirmModal";
import { RawDataModal } from "./rawDataModal";

export const VIEW_TYPE = "plugin-download-dashboard-view";

type Tab = "watchlist" | "browse";

interface Target {
	id: string; // plugin id
	name: string;
	repo: string;
}

interface DetailState {
	target: Target;
	watched: boolean; // watched => stored history; browse => ephemeral
	hist: Snapshot[];
	loading: boolean;
}

const BROWSE_CAP = 60;

export class DashboardView extends ItemView {
	plugin: PluginDownloadDashboard;
	private activeTab: Tab = "watchlist";
	private search = "";
	private detail: DetailState | null = null;
	private charts: HTMLElement[] = [];
	private chartObservers: ResizeObserver[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: PluginDownloadDashboard) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Plugin Download Dashboard";
	}

	getIcon(): string {
		return "bar-chart-3";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("pdd-view");
		await this.plugin.ensureLists();
		if (this.plugin.data.settings.autoRefreshOnOpen) {
			await this.plugin.refreshWatchlist(true);
		}
		this.render();
	}

	async onClose(): Promise<void> {
		this.purgeCharts();
	}

	private purgeCharts(): void {
		for (const ro of this.chartObservers) ro.disconnect();
		this.chartObservers = [];
		for (const el of this.charts) purgeChart(el);
		this.charts = [];
	}

	// ---- rendering ---------------------------------------------------------

	private render(): void {
		this.purgeCharts();
		const root = this.contentEl;
		root.empty();

		if (this.detail) {
			this.renderDetail(root);
			return;
		}

		this.renderTabBar(root);
		const content = root.createDiv({ cls: "pdd-tabcontent" });
		if (this.activeTab === "watchlist") this.renderWatchlist(content);
		else this.renderBrowse(content);
	}

	private renderTabBar(parent: HTMLElement): void {
		const bar = parent.createDiv({ cls: "pdd-tabbar" });
		const tabs: [Tab, string][] = [
			["watchlist", "Watchlist"],
			["browse", "Browse"],
		];
		for (const [id, label] of tabs) {
			const el = bar.createDiv({
				cls: "pdd-tab" + (this.activeTab === id ? " is-active" : ""),
				attr: { role: "tab" },
			});
			el.setText(label);
			el.addEventListener("click", () => {
				if (this.activeTab !== id) {
					this.activeTab = id;
					this.search = "";
					this.render();
				}
			});
		}
	}

	/** All-plugins browse-and-search tab. Every card is clickable → on-the-fly
	 *  dashboard built from the live stats JSON (nothing is persisted). */
	private renderBrowse(parent: HTMLElement): void {
		const searchbar = parent.createDiv({ cls: "pdd-searchbar" });
		const input = searchbar.createEl("input", {
			cls: "pdd-search",
			attr: { type: "text", placeholder: "Search community plugins…" },
		});
		input.value = this.search;
		const count = parent.createDiv({ cls: "pdd-count" });
		const list = parent.createDiv({ cls: "pdd-list" });

		const repaint = () => {
			list.empty();
			const cache = this.plugin.data.listCache;
			if (!cache) {
				count.setText("");
				this.emptyState(
					list,
					"cloud-off",
					"No community data",
					"Couldn't load the community plugin list. Check your connection and reopen the dashboard."
				);
				return;
			}
			const q = this.search.trim().toLowerCase();
			const matches = cache.plugins.filter((p) => matchesPlugin(p, q));

			let shown = 0;
			for (const p of matches) {
				if (shown >= BROWSE_CAP) break;
				this.renderBrowseCard(list, p);
				shown++;
			}

			if (matches.length === 0) {
				count.setText("");
				this.emptyState(
					list,
					"search-x",
					"No matches",
					q ? `Nothing matches "${this.search}".` : "No community plugins loaded yet."
				);
			} else if (shown < matches.length) {
				count.setText(`Showing first ${shown} of ${matches.length} — keep typing to narrow it down.`);
			} else {
				count.setText(`${matches.length} result${matches.length === 1 ? "" : "s"}`);
			}
		};

		input.addEventListener("input", () => {
			this.search = input.value;
			repaint();
		});
		repaint();

		// Load the stats JSON once so cards can show total downloads; repaint
		// when it arrives (if we're still on the Browse list).
		if (!this.plugin.hasStats()) {
			this.plugin
				.getStats()
				.then(() => {
					if (list.isConnected) repaint();
				})
				.catch(() => {
					/* totals just won't show */
				});
		}
	}

	/** Watchlisted plugins; clicking a card opens its stored-history dashboard. */
	private renderWatchlist(parent: HTMLElement): void {
		const searchbar = parent.createDiv({ cls: "pdd-searchbar" });
		const input = searchbar.createEl("input", {
			cls: "pdd-search",
			attr: { type: "text", placeholder: "Filter watchlist…" },
		});
		input.value = this.search;
		const refresh = searchbar.createEl("button", { cls: "pdd-refresh-icon" });
		setIcon(refresh, "refresh-cw");
		refresh.setAttr("aria-label", "Refresh all watched plugins");
		refresh.addEventListener("click", async () => {
			refresh.toggleClass("is-busy", true);
			try {
				await this.plugin.refreshWatchlist(false);
			} finally {
				refresh.toggleClass("is-busy", false);
			}
			this.render();
		});

		const list = parent.createDiv({ cls: "pdd-list" });

		const repaint = () => {
			list.empty();
			const q = this.search.trim().toLowerCase();
			const items = this.watchedTargets().filter((it) => !q || it.name.toLowerCase().includes(q));
			if (items.length === 0) {
				this.emptyState(
					list,
					"eye",
					"Nothing watchlisted yet",
					"Open a plugin from the Browse tab and hit Watchlist. From then on, each refresh records a timestamped snapshot so you can track downloads over time — even within a single release."
				);
				return;
			}
			for (const it of items) this.renderWatchlistCard(list, it);
		};

		input.addEventListener("input", () => {
			this.search = input.value;
			repaint();
		});
		repaint();
	}

	private renderBrowseCard(parent: HTMLElement, p: CommunityPlugin): void {
		const card = parent.createDiv({ cls: "pdd-card is-clickable" });
		const target: Target = { id: p.id, name: p.name, repo: p.repo };
		card.addEventListener("click", () => this.openDetail(target));

		const main = card.createDiv({ cls: "pdd-card-main" });
		main.createDiv({ cls: "pdd-nameline" }).createSpan({ cls: "pdd-name", text: p.name });
		if (p.description) main.createDiv({ cls: "pdd-desc", text: p.description });
		main.createDiv({ cls: "pdd-sub", text: `${p.author} · ${p.repo}` });

		const total = this.plugin.cachedTotal(p.id);
		const stats = main.createDiv({ cls: "pdd-cardstats" });
		const dl = stats.createSpan({ cls: "pdd-stat" });
		setIcon(dl.createSpan({ cls: "pdd-stat-icon" }), "download");
		dl.createSpan({ text: total !== null ? `${fmtNum(total)} downloads` : "… downloads" });

		const actions = card.createDiv({ cls: "pdd-actions" });
		const open = actions.createEl("button", { cls: "pdd-action pdd-action-primary" });
		setIcon(open, "line-chart");
		open.createSpan({ text: "Open dashboard" });
		open.addEventListener("click", (e) => {
			e.stopPropagation();
			this.openDetail(target);
		});
		this.renderWatchButton(actions, target);
	}

	private renderWatchButton(parent: HTMLElement, t: Target): void {
		const watched = this.plugin.isWatched(t.id);
		const btn = parent.createEl("button", {
			cls: "pdd-action" + (watched ? " is-watched" : ""),
		});
		setIcon(btn, watched ? "eye-off" : "eye");
		btn.createSpan({ text: watched ? "Unwatch" : "Watchlist" });
		btn.setAttr("aria-label", watched ? "Remove from watchlist" : "Add to watchlist");
		btn.addEventListener("click", async (e) => {
			e.stopPropagation();
			if (watched) this.confirmUnwatch(t);
			else await this.watchAndRender(t);
		});
	}

	private renderWatchlistCard(parent: HTMLElement, it: Target): void {
		const card = parent.createDiv({ cls: "pdd-card is-clickable" });
		card.addEventListener("click", () => this.openDetail(it));

		const main = card.createDiv({ cls: "pdd-card-main" });
		main.createDiv({ cls: "pdd-nameline" }).createSpan({ cls: "pdd-name", text: it.name });

		const p = this.plugin.findPlugin(it.id);
		if (p?.repo) main.createDiv({ cls: "pdd-sub", text: `${p.author} · ${p.repo}` });

		const hist = this.plugin.snapshotsFor(it.id);
		const latest = hist[hist.length - 1];
		const statsRow = main.createDiv({ cls: "pdd-cardstats" });
		if (latest) {
			const dl = statsRow.createSpan({ cls: "pdd-stat" });
			setIcon(dl.createSpan({ cls: "pdd-stat-icon" }), "download");
			dl.createSpan({ text: `${fmtNum(latest.total)} downloads` });
			const sn = statsRow.createSpan({ cls: "pdd-stat" });
			setIcon(sn.createSpan({ cls: "pdd-stat-icon" }), "history");
			sn.createSpan({ text: `${hist.length} snapshot${hist.length === 1 ? "" : "s"}` });
		} else {
			statsRow.createSpan({ cls: "pdd-stat", text: "No snapshots yet — open to capture one" });
		}

		const actions = card.createDiv({ cls: "pdd-actions" });
		const open = actions.createEl("button", { cls: "pdd-action pdd-action-primary" });
		setIcon(open, "line-chart");
		open.createSpan({ text: "Open dashboard" });
		open.addEventListener("click", (e) => {
			e.stopPropagation();
			this.openDetail(it);
		});

		const raw = actions.createEl("button", { cls: "pdd-action" });
		setIcon(raw, "table");
		raw.createSpan({ text: "View raw data" });
		raw.addEventListener("click", (e) => {
			e.stopPropagation();
			new RawDataModal(this.app, it.name, hist).open();
		});

		const unwatch = actions.createEl("button", { cls: "pdd-action" });
		setIcon(unwatch, "eye-off");
		unwatch.createSpan({ text: "Unwatch" });
		unwatch.addEventListener("click", (e) => {
			e.stopPropagation();
			this.confirmUnwatch(it);
		});
	}

	// ---- detail (dashboard) ------------------------------------------------

	/** Open a plugin's dashboard. Watched plugins render their stored history;
	 *  browse plugins render an ephemeral snapshot fetched on the fly. */
	private async openDetail(target: Target): Promise<void> {
		const watched = this.plugin.isWatched(target.id);
		this.detail = { target, watched, hist: [], loading: true };
		this.render();
		await this.loadDetailData();
		this.render();
	}

	private async loadDetailData(): Promise<void> {
		const d = this.detail;
		if (!d) return;
		try {
			if (d.watched) {
				d.hist = this.plugin.snapshotsFor(d.target.id);
				if (d.target.repo) {
					await this.plugin.ensureReleaseDates(d.target.repo, latestVersions(d.hist));
				}
			} else {
				const snap = await this.plugin.liveSnapshot(d.target.id);
				if (snap && d.target.repo) {
					await this.plugin.ensureReleaseDates(d.target.repo, Object.keys(snap.releases));
				}
				d.hist = snap ? [snap] : [];
			}
		} catch (e) {
			new Notice(`Plugin Download Dashboard: ${msg(e)}`);
		} finally {
			d.loading = false;
		}
	}

	private renderDetail(parent: HTMLElement): void {
		const d = this.detail;
		if (!d) return;

		const bar = parent.createDiv({ cls: "pdd-detailbar" });
		const back = bar.createEl("button", { cls: "pdd-action" });
		setIcon(back, "arrow-left");
		back.createSpan({ text: "Back" });
		back.addEventListener("click", () => {
			this.detail = null;
			this.render();
		});

		// Title + a link out to the plugin's GitHub repo, near the top.
		const titleWrap = bar.createDiv({ cls: "pdd-detail-titlewrap" });
		titleWrap.createSpan({ cls: "pdd-detail-title", text: d.target.name });
		if (d.target.repo) {
			const link = titleWrap.createEl("a", {
				cls: "pdd-repo-link",
				href: `https://github.com/${d.target.repo}`,
			});
			link.setAttr("target", "_blank");
			link.setAttr("rel", "noopener");
			setIcon(link.createSpan({ cls: "pdd-repo-link-icon" }), "github");
			link.createSpan({ text: d.target.repo });
		}

		if (d.watched) {
			const raw = bar.createEl("button", { cls: "pdd-action" });
			setIcon(raw, "table");
			raw.createSpan({ text: "View raw data" });
			raw.addEventListener("click", () =>
				new RawDataModal(this.app, d.target.name, this.plugin.snapshotsFor(d.target.id)).open()
			);

			const refresh = bar.createEl("button", { cls: "pdd-action" });
			setIcon(refresh, "refresh-cw");
			refresh.createSpan({ text: "Refresh" });
			refresh.addEventListener("click", async () => {
				refresh.toggleClass("is-busy", true);
				try {
					await this.plugin.refreshItem(d.target.id, d.target.repo);
					d.hist = this.plugin.snapshotsFor(d.target.id);
				} catch (err) {
					new Notice(`Plugin Download Dashboard: ${msg(err)}`);
				} finally {
					refresh.toggleClass("is-busy", false);
				}
				this.render();
			});

			const unwatch = bar.createEl("button", { cls: "pdd-action" });
			setIcon(unwatch, "eye-off");
			unwatch.createSpan({ text: "Unwatch" });
			unwatch.addEventListener("click", () => this.confirmUnwatch(d.target));
		} else {
			const watch = bar.createEl("button", { cls: "pdd-action pdd-action-primary" });
			setIcon(watch, "eye");
			watch.createSpan({ text: "Watchlist" });
			watch.addEventListener("click", () => this.watchAndRender(d.target, true));
		}

		const body = parent.createDiv({ cls: "pdd-detailbody" });

		if (d.loading) {
			this.emptyState(body, "loader", "Loading…", "Fetching the latest download data.");
			return;
		}
		if (d.hist.length === 0) {
			this.emptyState(
				body,
				"line-chart",
				"No download data",
				"Couldn't find download data for this plugin in the community stats."
			);
			return;
		}

		if (!d.watched) {
			const snap = d.hist[d.hist.length - 1];
			const stampMs = snap.updated > 0 ? snap.updated : snap.ts;
			const hint = body.createDiv({ cls: "pdd-detail-hint" });
			setIcon(hint.createSpan({ cls: "pdd-detail-hint-icon" }), "info");
			hint.createSpan({
				text: `Data from current community stats as of ${fmtDate(new Date(stampMs).toISOString())}. Watchlist this plugin to record snapshots between releases to track granular download trends over time.`,
			});
		}

		const releaseDates = this.plugin.data.releaseDates[d.target.repo] ?? {};

		// Charts: cumulative growth over time (by release date) + donut by release.
		const charts = body.createDiv({ cls: "pdd-charts" });
		const lineWrap = charts.createDiv({ cls: "pdd-chart" });
		lineWrap.createDiv({ cls: "pdd-chart-title", text: "Cumulative downloads over time" });
		const lineEl = lineWrap.createDiv({ cls: "pdd-plot" });

		const donutWrap = charts.createDiv({ cls: "pdd-chart" });
		donutWrap.createDiv({ cls: "pdd-chart-title", text: "Downloads by release" });
		const donutEl = donutWrap.createDiv({ cls: "pdd-plot" });

		renderLineChart(lineEl, buildGrowthSeries(d.hist, releaseDates));
		renderDonut(donutEl, buildDonutData(d.hist));
		this.charts.push(lineEl, donutEl);
		this.chartObservers.push(autoResize(lineEl), autoResize(donutEl));

		// Table. Watched plugins show the combined timeline (releases + captured
		// granularity between them); browse shows the per-release list.
		if (d.watched) this.renderCombinedTable(body, d.hist, releaseDates);
		else this.renderReleaseTable(body, d.hist, releaseDates);
	}

	private renderReleaseTable(
		parent: HTMLElement,
		hist: Snapshot[],
		releaseDates: Record<string, string>
	): void {
		const rows = buildReleaseTable(hist, releaseDates);
		const tableWrap = parent.createDiv({ cls: "pdd-tablewrap" });
		tableWrap.createDiv({ cls: "pdd-chart-title", text: "Releases over time" });
		const scroll = tableWrap.createDiv({ cls: "pdd-tablescroll" });
		const table = scroll.createEl("table", { cls: "pdd-table" });
		const headRow = table.createEl("thead").createEl("tr");
		for (const h of ["Release", "Released", "Downloads", "Running total"]) {
			headRow.createEl("th", { text: h });
		}
		const tbody = table.createEl("tbody");
		for (const r of rows) {
			const tr = tbody.createEl("tr");
			tr.createEl("td", { text: r.release });
			tr.createEl("td", { text: r.published ? fmtDate(r.published) : "—" });
			tr.createEl("td", { cls: "pdd-num", text: fmtNum(r.downloads) });
			tr.createEl("td", { cls: "pdd-num", text: fmtNum(r.runningTotal) });
		}
	}

	private renderCombinedTable(
		parent: HTMLElement,
		hist: Snapshot[],
		releaseDates: Record<string, string>
	): void {
		const rows = buildCombinedHistory(hist, releaseDates);
		const tableWrap = parent.createDiv({ cls: "pdd-tablewrap" });
		tableWrap.createDiv({ cls: "pdd-chart-title", text: "Download history" });
		const scroll = tableWrap.createDiv({ cls: "pdd-tablescroll" });
		const table = scroll.createEl("table", { cls: "pdd-table" });
		const headRow = table.createEl("thead").createEl("tr");
		for (const h of ["Date", "Release", "Downloads", "Running total"]) {
			headRow.createEl("th", { text: h });
		}
		const tbody = table.createEl("tbody");
		for (const r of rows) {
			const tr = tbody.createEl("tr", { cls: r.kind === "capture" ? "pdd-row-capture" : "" });

			// Date — release rows show the publish day; captures show date + time.
			tr.createEl("td", {
				text: r.date === null ? "—" : r.kind === "capture" ? fmtDateTime(r.date) : fmtDateMs(r.date),
			});

			// Release — the version (release rows) or the current release (captures).
			tr.createEl("td", { text: r.release ?? "—" });

			// Downloads — release: that release's count; capture: signed change.
			if (r.downloads === null) {
				tr.createEl("td", { cls: "pdd-num", text: "—" });
			} else if (r.kind === "capture") {
				tr.createEl("td", {
					cls:
						"pdd-num" +
						(r.downloads > 0 ? " pdd-delta-up" : r.downloads < 0 ? " pdd-delta-down" : ""),
					text: (r.downloads >= 0 ? "+" : "") + fmtNum(r.downloads),
				});
			} else {
				tr.createEl("td", { cls: "pdd-num", text: fmtNum(r.downloads) });
			}

			tr.createEl("td", { cls: "pdd-num", text: fmtNum(r.runningTotal) });
		}
	}

	// ---- actions -----------------------------------------------------------

	private async watchAndRender(t: Target, keepDetail = false): Promise<void> {
		await this.plugin.watch(t.id, t.repo);
		new Notice(`Plugin Download Dashboard: watchlisted "${t.name}" — now tracking over time.`);
		if (keepDetail && this.detail && this.detail.target.id === t.id) {
			this.detail.watched = true;
			this.detail.hist = this.plugin.snapshotsFor(t.id);
		}
		this.render();
	}

	private confirmUnwatch(t: Target): void {
		new ConfirmModal(this.app, {
			title: `Unwatch "${t.name}"?`,
			body: "This removes it from your watchlist and permanently deletes the download snapshots recorded for it. This can't be undone.",
			confirmText: "Unwatch & clear data",
			onConfirm: async () => {
				await this.plugin.unwatch(t.id);
				new Notice(`Plugin Download Dashboard: unwatched "${t.name}" and cleared its tracked data.`);
				if (this.detail && this.detail.target.id === t.id) this.detail = null;
				this.render();
			},
		}).open();
	}

	private emptyState(parent: HTMLElement, icon: string, title: string, body: string): void {
		const el = parent.createDiv({ cls: "pdd-empty" });
		const iconEl = el.createDiv({ cls: "pdd-empty-icon" });
		setIcon(iconEl, icon);
		el.createDiv({ cls: "pdd-empty-title", text: title });
		el.createDiv({ cls: "pdd-empty-body", text: body });
	}

	// ---- data shaping ------------------------------------------------------

	/** Resolve the watchlist ids into display targets (with name + repo). */
	private watchedTargets(): Target[] {
		const out: Target[] = this.plugin.data.watchlist.map((id) => {
			const p = this.plugin.findPlugin(id);
			return { id, name: p?.name ?? id, repo: p?.repo ?? "" };
		});
		out.sort((a, b) => a.name.localeCompare(b.name));
		return out;
	}
}

// ---- module-scope helpers --------------------------------------------------

function matchesPlugin(p: CommunityPlugin, q: string): boolean {
	if (!q) return true;
	return (
		p.name.toLowerCase().includes(q) ||
		p.id.toLowerCase().includes(q) ||
		p.author.toLowerCase().includes(q) ||
		p.description.toLowerCase().includes(q)
	);
}

function latestVersions(hist: Snapshot[]): string[] {
	const latest = hist[hist.length - 1];
	return latest ? Object.keys(latest.releases) : [];
}

function fmtNum(n: number): string {
	return n.toLocaleString();
}

function fmtDate(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function fmtDateMs(ts: number): string {
	return new Date(ts).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function fmtDateTime(ts: number): string {
	return new Date(ts).toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function msg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
