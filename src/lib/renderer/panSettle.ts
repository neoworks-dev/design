// After a pan drawn from a snapshot shifted by rounded pixels (panSnapshot.ts), the scene is
// drawn for real once the camera has rested. The renderer service owns one of these and disposes
// it when the plugin unloads.

const SETTLE_MILLISECONDS = 150;

export class PanSettle {
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly redraw: () => void) {}

	/** Restart the wait after every frame; only a rounded snapshot frame needs the redraw. */
	afterFrame(approximate: boolean): void {
		this.cancel();
		if (!approximate) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.redraw();
		}, SETTLE_MILLISECONDS);
	}

	cancel(): void {
		if (this.timer === undefined) return;
		clearTimeout(this.timer);
		this.timer = undefined;
	}
}
