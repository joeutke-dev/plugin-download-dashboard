import { App, Modal, Notice, setIcon } from "obsidian";
import type { Snapshot } from "./types";

/** Shows the raw stored snapshot dataset for a watched plugin, so you can watch
 *  it grow with each refresh and verify the dataset-building behavior. */
export class RawDataModal extends Modal {
	private name: string;
	private snapshots: Snapshot[];

	constructor(app: App, name: string, snapshots: Snapshot[]) {
		super(app);
		this.name = name;
		this.snapshots = snapshots;
	}

	onOpen(): void {
		this.titleEl.setText(`Raw data — ${this.name}`);
		const c = this.contentEl;
		c.createEl("p", {
			cls: "pdd-raw-note",
			text: `${this.snapshots.length} snapshot${this.snapshots.length === 1 ? "" : "s"} stored. Each refresh that finds new data (a changed source "updated" stamp) appends one.`,
		});

		if (this.snapshots.length === 0) {
			c.createEl("p", { text: "No snapshots recorded yet." });
			return;
		}

		// One row per capture, newest first — the growing dataset at a glance.
		const scroll = c.createDiv({ cls: "pdd-raw-tablescroll" });
		const table = scroll.createEl("table", { cls: "pdd-table" });
		const hr = table.createEl("thead").createEl("tr");
		for (const h of ["#", "Captured", "Total downloads", "Δ vs last", "Releases"]) {
			hr.createEl("th", { text: h });
		}
		const tb = table.createEl("tbody");
		for (let i = this.snapshots.length - 1; i >= 0; i--) {
			const s = this.snapshots[i];
			const tr = tb.createEl("tr");
			tr.createEl("td", { cls: "pdd-num", text: String(i + 1) });
			tr.createEl("td", { text: new Date(s.ts).toLocaleString() });
			tr.createEl("td", { cls: "pdd-num", text: s.total.toLocaleString() });
			// Delta vs the chronologically previous capture; "—" for the first.
			if (i === 0) {
				tr.createEl("td", { cls: "pdd-num", text: "—" });
			} else {
				const delta = s.total - this.snapshots[i - 1].total;
				tr.createEl("td", {
					cls: "pdd-num" + (delta > 0 ? " pdd-delta-up" : delta < 0 ? " pdd-delta-down" : ""),
					text: (delta >= 0 ? "+" : "") + delta.toLocaleString(),
				});
			}
			tr.createEl("td", { cls: "pdd-num", text: String(Object.keys(s.releases).length) });
		}

		// Full raw JSON (what's actually persisted) with a copy button.
		const rawWrap = c.createDiv({ cls: "pdd-raw-wrap" });
		const bar = rawWrap.createDiv({ cls: "pdd-raw-bar" });
		bar.createSpan({ cls: "pdd-chart-title", text: "Stored JSON" });
		const copy = bar.createEl("button", { cls: "pdd-action" });
		setIcon(copy, "copy");
		copy.createSpan({ text: "Copy JSON" });
		const json = JSON.stringify(this.snapshots, null, 2);
		const pre = rawWrap.createEl("pre", { cls: "pdd-raw-json" });
		pre.setText(json);
		copy.addEventListener("click", async () => {
			await navigator.clipboard.writeText(json);
			new Notice("Plugin Download Dashboard: copied raw data JSON.");
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
