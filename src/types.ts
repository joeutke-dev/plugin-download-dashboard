// Shared types + persistence shape for Plugin Download Dashboard.

/** An entry from the community-plugins.json array. */
export interface CommunityPlugin {
	id: string;
	name: string;
	author: string;
	description: string;
	repo: string; // "owner/name" on GitHub
}

/** One plugin's entry in community-plugin-stats.json: a `downloads` total, an
 *  `updated` epoch-ms stamp, and one numeric key per release version. */
export interface PluginStatEntry {
	downloads: number;
	updated: number;
	[version: string]: number;
}

export type PluginStats = Record<string, PluginStatEntry>;

/** A point-in-time capture of a watched plugin's per-release download counts.
 *  Snapshotting these over time turns the repo's single cumulative snapshot
 *  into a live trend; combined with release dates it reconstructs history. */
export interface Snapshot {
	ts: number; // when WE captured it (epoch ms)
	updated: number; // source 'updated' stamp (epoch ms); -1 when unknown
	releases: Record<string, number>; // version -> cumulative downloads
	total: number; // total downloads at capture time
}

export interface Settings {
	githubToken: string;
	autoRefreshOnOpen: boolean;
	dailyAutoRefresh: boolean;
	maxSnapshots: number;
}

export const DEFAULT_SETTINGS: Settings = {
	githubToken: "",
	autoRefreshOnOpen: true,
	dailyAutoRefresh: true,
	maxSnapshots: 500,
};

export interface ListCache {
	plugins: CommunityPlugin[];
	fetchedAt: number;
}

/** The full persisted blob (saveData/loadData). Snapshots and release dates are
 *  keyed by plugin id and repo respectively. */
export interface PluginData {
	watchlist: string[]; // watchlisted plugin ids
	snapshots: Record<string, Snapshot[]>; // plugin id -> capture history
	/** repo ("owner/name") -> version -> ISO publish date, cached from the
	 *  GitHub Releases API (dates are immutable once published). Both the raw
	 *  tag and its no-"v" form are stored so stats version keys match. */
	releaseDates: Record<string, Record<string, string>>;
	listCache: ListCache | null;
	/** Epoch ms of the last watchlist refresh (manual, on-open, or daily). Used
	 *  to decide whether the once-a-day background refresh is due. */
	lastRefresh: number;
	settings: Settings;
}

export const DEFAULT_DATA: PluginData = {
	watchlist: [],
	snapshots: {},
	releaseDates: {},
	listCache: null,
	lastRefresh: 0,
	settings: { ...DEFAULT_SETTINGS },
};
