// Plotly rendering helpers. Colors follow the active Obsidian theme.
import Plotly from "plotly.js-dist-min";
import type { DonutData, LineSeries } from "./model";

interface ThemeColors {
	accent: string;
	text: string;
	muted: string;
	grid: string;
	transparent: string;
	palette: string[];
}

function themeColors(): ThemeColors {
	const style = getComputedStyle(document.body);
	const read = (name: string, fallback: string) =>
		style.getPropertyValue(name).trim() || fallback;
	const dark = document.body.classList.contains("theme-dark");
	return {
		accent: read("--interactive-accent", "#7c6ff0"),
		text: read("--text-normal", dark ? "#dcddde" : "#1f2328"),
		muted: read("--text-muted", dark ? "#9aa0a6" : "#6b7280"),
		grid: read("--background-modifier-border", dark ? "#3a3a3a" : "#e3e3e3"),
		transparent: "rgba(0,0,0,0)",
		// A categorical palette for the donut (brand-neutral, works light/dark).
		palette: [
			read("--interactive-accent", "#7c6ff0"),
			"#4caf93",
			"#e0a458",
			"#d16666",
			"#5b8def",
			"#b07bd1",
			"#8bbf5a",
			"#d98cae",
			"#59b3c3",
			"#c9a227",
		],
	};
}

const CONFIG = { displayModeBar: false, responsive: true } as const;

/** Line chart of total downloads over the captured snapshots. */
export function renderLineChart(el: HTMLElement, series: LineSeries): void {
	const c = themeColors();
	const data = [
		{
			type: "scatter",
			mode: "lines+markers",
			x: series.x.map((t) => new Date(t)),
			y: series.y,
			// Linear (not spline): the data is monotonic cumulative, so splines
			// would overshoot and wiggle between points.
			line: { color: c.accent, width: 2, shape: "linear" },
			marker: { color: c.accent, size: 6 },
			hovertemplate: "%{x|%b %-d, %Y %-H:%M}<br>%{y:,} downloads<extra></extra>",
		},
	];
	const layout = {
		height: 240,
		margin: { l: 60, r: 16, t: 10, b: 44 },
		paper_bgcolor: c.transparent,
		plot_bgcolor: c.transparent,
		font: { color: c.muted, size: 11 },
		xaxis: { gridcolor: c.grid, linecolor: c.grid, zeroline: false },
		yaxis: {
			gridcolor: c.grid,
			linecolor: c.grid,
			zeroline: false,
			rangemode: "tozero",
			tickformat: "~s",
		},
		showlegend: false,
	};
	Plotly.react(el, data, layout, CONFIG);
}

/** Donut of downloads by release for the latest snapshot. */
export function renderDonut(el: HTMLElement, data: DonutData): void {
	const c = themeColors();
	const trace = [
		{
			type: "pie",
			hole: 0.56,
			labels: data.labels,
			values: data.values,
			textinfo: "none",
			sort: true,
			direction: "clockwise",
			marker: { colors: c.palette, line: { color: c.transparent, width: 1 } },
			hovertemplate: "%{label}<br>%{value:,} downloads (%{percent})<extra></extra>",
		},
	];
	const layout = {
		height: 300,
		margin: { l: 8, r: 8, t: 10, b: 8 },
		paper_bgcolor: c.transparent,
		plot_bgcolor: c.transparent,
		font: { color: c.muted, size: 11 },
		showlegend: true,
		// Bottom legend so the donut uses the full width of its (narrower) column.
		legend: {
			font: { color: c.muted, size: 10 },
			orientation: "h",
			y: -0.08,
			x: 0.5,
			xanchor: "center",
			yanchor: "top",
		},
	};
	Plotly.react(el, trace, layout, CONFIG);
}

/** Keep a Plotly chart fitted to its container as the pane is resized (Obsidian
 *  pane drags don't fire window resize, which is all Plotly's `responsive`
 *  listens to). Returns an observer the caller disconnects on teardown. */
export function autoResize(el: HTMLElement): ResizeObserver {
	const ro = new ResizeObserver(() => {
		try {
			Plotly.Plots.resize(el);
		} catch {
			/* chart may be gone */
		}
	});
	ro.observe(el);
	return ro;
}

/** Tear down a Plotly chart to free its listeners/DOM. */
export function purgeChart(el: HTMLElement): void {
	try {
		Plotly.purge(el);
	} catch {
		/* element may already be detached */
	}
}
