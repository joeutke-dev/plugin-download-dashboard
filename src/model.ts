// Pure, Obsidian-free data transforms. Unit-tested in test/smoke.mjs.
import type { PluginStatEntry, Snapshot } from "./types";

const META_KEYS = new Set(["downloads", "updated"]);

/** Extract just the per-version download counts from a plugin stats entry,
 *  dropping the `downloads`/`updated` meta keys. */
export function releasesFromStatEntry(entry: PluginStatEntry): Record<string, number> {
	const out: Record<string, number> = {};
	for (const k of Object.keys(entry)) {
		if (META_KEYS.has(k)) continue;
		const v = (entry as Record<string, number>)[k];
		if (typeof v === "number") out[k] = v;
	}
	return out;
}

/** Build a Snapshot from a plugin stats entry. */
export function snapshotFromStatEntry(entry: PluginStatEntry, ts = Date.now()): Snapshot {
	const releases = releasesFromStatEntry(entry);
	const total =
		typeof entry.downloads === "number"
			? entry.downloads
			: sum(Object.values(releases));
	return { ts, updated: typeof entry.updated === "number" ? entry.updated : -1, releases, total };
}

/** Build a Snapshot from an arbitrary version->downloads map (used for themes,
 *  whose counts come from GitHub release assets and have no `updated` stamp). */
export function snapshotFromReleases(
	releases: Record<string, number>,
	updated = -1,
	ts = Date.now()
): Snapshot {
	return { ts, updated, releases: { ...releases }, total: sum(Object.values(releases)) };
}

/** Append `snap` to history, unless it duplicates the previous capture. Dedupe
 *  uses the source `updated` stamp when both are known (plugins); otherwise it
 *  falls back to comparing the total (themes). Returns the SAME array reference
 *  when nothing was appended, so callers can cheaply detect "no change". Caps
 *  length at `maxSnapshots`, keeping the most recent. */
export function appendSnapshot(history: Snapshot[], snap: Snapshot, maxSnapshots = 500): Snapshot[] {
	const last = history[history.length - 1];
	if (last) {
		if (last.updated >= 0 && snap.updated >= 0) {
			if (last.updated === snap.updated) return history;
		} else if (last.total === snap.total) {
			return history;
		}
	}
	const next = [...history, snap];
	return next.length > maxSnapshots ? next.slice(next.length - maxSnapshots) : next;
}

export interface ReleaseTableRow {
	release: string; // version
	published: string | null; // ISO publish date, or null if unknown
	downloads: number; // downloads for that release
	runningTotal: number; // cumulative downloads across releases up to this one
}

/** One row per release from the latest snapshot: release, its GitHub publish
 *  date, its own download count, and the running cumulative total up to it —
 *  newest release first (undated releases last). */
export function buildReleaseTable(
	history: Snapshot[],
	releaseDates: Record<string, string>
): ReleaseTableRow[] {
	const latest = history[history.length - 1];
	if (!latest) return [];
	const running = runningTotals(latest.releases, releaseDates);
	const rows: ReleaseTableRow[] = Object.keys(latest.releases).map((v) => ({
		release: v,
		published: releaseDates[v] ?? null,
		downloads: latest.releases[v],
		runningTotal: running[v],
	}));
	rows.sort((a, b) => {
		const ta = a.published ? Date.parse(a.published) : -Infinity;
		const tb = b.published ? Date.parse(b.published) : -Infinity;
		if (tb !== ta) return tb - ta; // newest release first
		return b.downloads - a.downloads;
	});
	return rows;
}

/** Cumulative downloads per release, summed in chronological order (undated
 *  releases counted first as a baseline, then dated ascending). The newest
 *  release's running total equals the plugin's grand total. */
function runningTotals(
	releases: Record<string, number>,
	releaseDates: Record<string, string>
): Record<string, number> {
	const dateOf = (v: string): number | null => {
		const iso = releaseDates[v];
		const t = iso ? Date.parse(iso) : NaN;
		return Number.isNaN(t) ? null : t;
	};
	const chrono = Object.keys(releases).sort((a, b) => {
		const ta = dateOf(a);
		const tb = dateOf(b);
		if (ta === null && tb === null) return 0;
		if (ta === null) return -1; // undated first (baseline)
		if (tb === null) return 1;
		return ta - tb;
	});
	const out: Record<string, number> = {};
	let run = 0;
	for (const v of chrono) {
		run += releases[v];
		out[v] = run;
	}
	return out;
}

export type CombinedRowKind = "release" | "capture";

export interface CombinedRow {
	kind: CombinedRowKind;
	date: number | null; // epoch ms (null = undated release)
	release: string | null; // release row: the version; capture row: current release
	/** release row: that release's own downloads; capture row: change in total
	 *  since the previous capture (null for the first capture). */
	downloads: number | null;
	/** release row: cumulative total up to that release; capture row: the
	 *  measured total at that capture. */
	runningTotal: number;
}

/** A combined, time-ordered timeline (newest first) for a watched plugin:
 *  release events from the JSON, interleaved with the stored snapshot captures
 *  that show download growth BETWEEN releases. Release rows carry per-release
 *  downloads + the cumulative running total; capture rows carry the change
 *  since the last capture + the measured running total at that moment. */
export function buildCombinedHistory(
	history: Snapshot[],
	releaseDates: Record<string, string>
): CombinedRow[] {
	const rows: CombinedRow[] = [];

	const latest = history[history.length - 1];
	if (latest) {
		const running = runningTotals(latest.releases, releaseDates);
		for (const v of Object.keys(latest.releases)) {
			const iso = releaseDates[v];
			const t = iso ? Date.parse(iso) : NaN;
			rows.push({
				kind: "release",
				date: Number.isNaN(t) ? null : t,
				release: v,
				downloads: latest.releases[v],
				runningTotal: running[v],
			});
		}
	}

	for (let i = 0; i < history.length; i++) {
		const s = history[i];
		rows.push({
			kind: "capture",
			date: s.ts,
			release: currentReleaseAt(s, releaseDates),
			downloads: i > 0 ? s.total - history[i - 1].total : null,
			runningTotal: s.total,
		});
	}

	rows.sort((a, b) => {
		const ta = a.date ?? Number.NEGATIVE_INFINITY;
		const tb = b.date ?? Number.NEGATIVE_INFINITY;
		return tb - ta; // newest first; undated releases last
	});
	return rows;
}

/** The newest release (by publish date) that existed at a snapshot's capture
 *  time. Only versions present in that snapshot with a known, not-future date
 *  are considered. Returns null when no release date is known. */
function currentReleaseAt(snap: Snapshot, releaseDates: Record<string, string>): string | null {
	let best: string | null = null;
	let bestT = Number.NEGATIVE_INFINITY;
	for (const v of Object.keys(snap.releases)) {
		const iso = releaseDates[v];
		if (!iso) continue;
		const t = Date.parse(iso);
		if (Number.isNaN(t)) continue;
		if (t <= snap.ts && t > bestT) {
			bestT = t;
			best = v;
		}
	}
	return best;
}

export interface LineSeries {
	x: number[]; // epoch ms (release publish dates, then live-capture dates)
	y: number[]; // cumulative downloads at each point
}

/** Cumulative-downloads-over-time growth curve. Each release's current download
 *  count is attributed to its GitHub publish date, cumulated chronologically —
 *  reconstructing historical growth from a single stats snapshot. Any downloads
 *  for versions with no known date are folded into a baseline. Live snapshots
 *  captured after the last release date extend the curve forward in real time. */
export function buildGrowthSeries(
	history: Snapshot[],
	releaseDates: Record<string, string>
): LineSeries {
	const latest = history[history.length - 1];
	if (!latest) return { x: [], y: [] };

	const dated: { t: number; d: number }[] = [];
	let baseline = 0;
	for (const v of Object.keys(latest.releases)) {
		const iso = releaseDates[v];
		const t = iso ? Date.parse(iso) : NaN;
		const d = latest.releases[v];
		if (!Number.isNaN(t)) dated.push({ t, d });
		else baseline += d; // undated version -> baseline
	}
	dated.sort((a, b) => a.t - b.t);

	const x: number[] = [];
	const y: number[] = [];
	let cum = baseline;
	for (const p of dated) {
		cum += p.d;
		x.push(p.t);
		y.push(cum);
	}

	// Extend with live captures newer than the last release date.
	const lastT = x.length ? x[x.length - 1] : Number.NEGATIVE_INFINITY;
	for (const s of history) {
		if (s.ts > lastT) {
			x.push(s.ts);
			y.push(s.total);
		}
	}
	return { x, y };
}

export interface DonutData {
	labels: string[];
	values: number[];
}

/** Downloads-by-release from the most recent snapshot, sorted desc. */
export function buildDonutData(history: Snapshot[]): DonutData {
	const latest = history[history.length - 1];
	if (!latest) return { labels: [], values: [] };
	const labels = Object.keys(latest.releases).sort(
		(a, b) => latest.releases[b] - latest.releases[a]
	);
	return { labels, values: labels.map((v) => latest.releases[v]) };
}

function sum(nums: number[]): number {
	return nums.reduce((a, b) => a + b, 0);
}
