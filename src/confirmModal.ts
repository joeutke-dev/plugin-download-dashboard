import { App, Modal } from "obsidian";

interface ConfirmOptions {
	title: string;
	body: string;
	confirmText: string;
	onConfirm: () => void;
}

/** A minimal yes/no confirmation dialog (Obsidian ships no built-in confirm). */
export class ConfirmModal extends Modal {
	private opts: ConfirmOptions;

	constructor(app: App, opts: ConfirmOptions) {
		super(app);
		this.opts = opts;
	}

	onOpen(): void {
		this.titleEl.setText(this.opts.title);
		this.contentEl.createEl("p", { text: this.opts.body });
		const buttons = this.contentEl.createDiv({ cls: "pdd-modal-buttons" });
		const cancel = buttons.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		const confirm = buttons.createEl("button", {
			cls: "mod-warning",
			text: this.opts.confirmText,
		});
		confirm.addEventListener("click", () => {
			this.close();
			this.opts.onConfirm();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
