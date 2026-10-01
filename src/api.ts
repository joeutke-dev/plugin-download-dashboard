// All network access lives here, via Obsidian's requestUrl (no CORS issues).
// The plugin's whole purpose is reading these public endpoints, as disclosed
// in the manifest description.
import { requestUrl } from "obsidian";
import type { CommunityPlugin, PluginStats } from "./types";

const RELEASES_BASE =
	"https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master";

/** Thrown when the GitHub API returns 403 (rate limit / auth). */
export class RateLimitError extends Error {
	constructor() {
		super("GitHub API rate limit reached — add a personal access token in settings.");
		this.name = "RateLimitError";
	}
}

export async function fetchCommunityPlugins(): Promise<CommunityPlugin[]> {
	const res = await requestUrl({ url: `${RELEASES_BASE}/community-plugins.json` });
	return res.json as CommunityPlugin[];
}

export async function fetchPluginStats(): Promise<PluginStats> {
	const res = await requestUrl({ url: `${RELEASES_BASE}/community-plugin-stats.json` });
	return res.json as PluginStats;
}

export interface GitHubRelease {
	tag_name: string;
	published_at: string;
}

/** Fetch a repo's GitHub releases, used for each version's publish date (the
 *  stats JSON has no dates). Returns [] for repos with no releases (404).
 *  Throws RateLimitError on 403. */
export async function fetchReleases(repo: string, token?: string): Promise<GitHubRelease[]> {
	const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
	if (token) headers["Authorization"] = `token ${token}`;
	const res = await requestUrl({
		url: `https://api.github.com/repos/${repo}/releases?per_page=100`,
		headers,
		throw: false,
	});
	if (res.status === 403) throw new RateLimitError();
	if (res.status === 404) return [];
	if (res.status >= 400) throw new Error(`GitHub API error ${res.status} for ${repo}`);
	return res.json as GitHubRelease[];
}
