// Smoke test for the pure model layer. Bundles src/model.ts with esbuild (no
// Obsidian needed) into a temp ESM module, imports it, and asserts behavior.
// Run: npm test
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import esbuild from "esbuild";

const out = join(tmpdir(), `pdd-model-${Date.now()}.mjs`);
await esbuild.build({
	entryPoints: ["src/model.ts"],
	bundle: true,
	format: "esm",
	outfile: out,
	logLevel: "silent",
});
const m = await import(`file://${out}`);

// --- snapshotFromStatEntry: splits meta keys from version keys ---
const snap = m.snapshotFromStatEntry({ downloads: 100, updated: 42, "1.0.0": 60, "1.1.0": 40 });
assert.equal(snap.total, 100, "total from downloads");
assert.equal(snap.updated, 42, "updated carried through");
assert.deepEqual(snap.releases, { "1.0.0": 60, "1.1.0": 40 }, "only version keys kept");

// --- appendSnapshot: dedupe on matching source `updated` ---
let hist = [];
hist = m.appendSnapshot(hist, m.snapshotFromStatEntry({ downloads: 100, updated: 1, "1.0.0": 100 }));
assert.equal(hist.length, 1, "first snapshot appended");
const same = m.appendSnapshot(hist, m.snapshotFromStatEntry({ downloads: 150, updated: 1, "1.0.0": 150 }));
assert.equal(same, hist, "same `updated` => same array ref (deduped)");
hist = m.appendSnapshot(hist, m.snapshotFromStatEntry({ downloads: 150, updated: 2, "1.0.0": 150 }));
assert.equal(hist.length, 2, "new `updated` => appended");

// --- appendSnapshot: themes (updated < 0) dedupe on total ---
let th = [];
th = m.appendSnapshot(th, m.snapshotFromReleases({ "v1": 10, "v2": 5 })); // total 15
const thSame = m.appendSnapshot(th, m.snapshotFromReleases({ "v1": 12, "v2": 3 })); // total 15
assert.equal(thSame, th, "theme same total => deduped");
th = m.appendSnapshot(th, m.snapshotFromReleases({ "v1": 20, "v2": 5 })); // total 25
assert.equal(th.length, 2, "theme changed total => appended");

// --- appendSnapshot: caps at maxSnapshots ---
let capped = [];
for (let i = 0; i < 10; i++) {
	capped = m.appendSnapshot(capped, m.snapshotFromStatEntry({ downloads: i, updated: i, "1.0.0": i }), 3);
}
assert.equal(capped.length, 3, "capped to maxSnapshots");
assert.equal(capped[capped.length - 1].total, 9, "keeps most recent");

// Shared history + release dates for the table/series tests.
const CAPTURE = Date.parse("2026-03-01T00:00:00Z"); // "now" — after both releases
const rowsHist = [m.snapshotFromReleases({ "1.0.0": 10, "1.1.0": 95, "1.2.0": 5 }, -1, CAPTURE)];
const dates = {
	"1.0.0": "2026-01-01T00:00:00Z",
	"1.1.0": "2026-02-01T00:00:00Z",
	// 1.2.0 intentionally has no date -> folded into baseline / sorted last
};

// --- buildReleaseTable: newest release first, undated last, running totals ---
const table = m.buildReleaseTable(rowsHist, dates);
assert.equal(table.length, 3, "one row per release");
assert.equal(table[0].release, "1.1.0", "newest dated release first");
assert.equal(table[0].published, "2026-02-01T00:00:00Z", "publish date attached");
assert.equal(table[1].release, "1.0.0", "older dated release next");
assert.equal(table[2].release, "1.2.0", "undated release sorts last");
assert.equal(table[2].published, null, "undated => null");
// running totals: baseline 1.2.0(5) -> +1.0.0(10)=15 -> +1.1.0(95)=110
assert.equal(table[0].downloads, 95, "release 1.1.0 own downloads");
assert.equal(table[0].runningTotal, 110, "running total ends at grand total");
assert.equal(table[1].runningTotal, 15, "running total at 1.0.0 (baseline 5 + 10)");
assert.equal(table[2].runningTotal, 5, "undated baseline running total");

// --- buildGrowthSeries: cumulative by release date (undated=baseline), plus
//     the live capture point (newer than the last release date) at the end ---
const growth = m.buildGrowthSeries(rowsHist, dates);
assert.deepEqual(
	growth.x,
	[Date.parse("2026-01-01T00:00:00Z"), Date.parse("2026-02-01T00:00:00Z"), CAPTURE],
	"x = dated release dates, then the live capture date"
);
// baseline (1.2.0=5) + 1.0.0(10) = 15, then + 1.1.0(95) = 110, then live total 110
assert.deepEqual(growth.y, [15, 110, 110], "cumulative incl. baseline, ending at current total");

// --- buildDonutData: latest snapshot, sorted desc ---
const donut = m.buildDonutData(rowsHist);
assert.deepEqual(donut.labels, ["1.1.0", "1.0.0", "1.2.0"], "labels sorted by downloads desc");
assert.deepEqual(donut.values, [95, 10, 5], "values match labels");

// --- buildCombinedHistory: release events + capture granularity, time-ordered ---
const hdates = { "1.0.0": "2026-01-01T00:00:00Z", "1.1.0": "2026-02-01T00:00:00Z" };
const hhist = [
	m.snapshotFromReleases({ "1.0.0": 100 }, 10, Date.parse("2026-01-15")), // total 100
	m.snapshotFromReleases({ "1.0.0": 100, "1.1.0": 50 }, 20, Date.parse("2026-02-10")), // 150
	m.snapshotFromReleases({ "1.0.0": 100, "1.1.0": 70 }, 30, Date.parse("2026-02-20")), // 170
];
const combined = m.buildCombinedHistory(hhist, hdates);
// 2 release rows + 3 capture rows, newest first by date:
// cap 02-20, cap 02-10, release 1.1.0 (02-01), cap 01-15, release 1.0.0 (01-01)
assert.equal(combined.length, 5, "release rows + capture rows");
assert.equal(combined[0].kind, "capture", "newest is the latest capture");
assert.equal(combined[0].date, Date.parse("2026-02-20"));
assert.equal(combined[0].downloads, 20, "capture delta vs previous (170-150)");
assert.equal(combined[0].runningTotal, 170, "capture running total = measured total");
assert.equal(combined[2].kind, "release", "1.1.0 release event in the middle");
assert.equal(combined[2].release, "1.1.0");
assert.equal(combined[2].downloads, 70, "release's own downloads");
assert.equal(combined[2].runningTotal, 170, "cumulative total at 1.1.0");
assert.equal(combined[3].kind, "capture", "capture inside the 1.0.0 period");
assert.equal(combined[3].downloads, null, "first capture has no delta");
assert.equal(combined[4].kind, "release", "oldest row is the 1.0.0 release");
assert.equal(combined[4].release, "1.0.0");
assert.equal(combined[4].runningTotal, 100, "cumulative total at 1.0.0");

// --- with no release dates, growth is just the live capture point(s) ---
const noDates = m.buildGrowthSeries(rowsHist, {});
assert.deepEqual(noDates.x, [CAPTURE], "no dates => only live capture point");
assert.deepEqual(noDates.y, [110], "y = total");

// --- empty history is safe ---
assert.deepEqual(m.buildDonutData([]), { labels: [], values: [] }, "empty donut");
assert.deepEqual(m.buildGrowthSeries([], {}), { x: [], y: [] }, "empty growth");
assert.deepEqual(m.buildReleaseTable([], {}), [], "empty table");

rmSync(out, { force: true });
console.log("✓ model smoke tests passed");
