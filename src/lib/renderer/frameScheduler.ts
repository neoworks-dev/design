// Coalesces frame requests: any number of `request` calls before the next animation frame produce
// exactly one `onFrame` call, which receives every reason that asked for it. The browser driver
// is injected so tests drive frames by hand and `cancel()` can be asserted.

export interface FrameDriver {
	request(callback: () => void): number;
	cancel(handle: number): void;
}

export const animationFrameDriver: FrameDriver = {
	request: (callback) => requestAnimationFrame(callback),
	cancel: (handle) => cancelAnimationFrame(handle)
};

export class FrameScheduler {
	private handle: number | undefined;
	private reasons: string[] = [];
	private stopped = false;

	constructor(
		private readonly driver: FrameDriver,
		private readonly onFrame: (reasons: string[]) => void
	) {}

	get isPending(): boolean {
		return this.handle !== undefined;
	}

	request(reason: string): void {
		if (this.stopped) return;
		if (!this.reasons.includes(reason)) this.reasons.push(reason);
		if (this.handle !== undefined) return;
		this.handle = this.driver.request(() => this.tick());
	}

	/** Cancels the pending frame and ignores further requests. */
	stop(): void {
		this.stopped = true;
		this.reasons = [];
		if (this.handle === undefined) return;
		this.driver.cancel(this.handle);
		this.handle = undefined;
	}

	private tick(): void {
		this.handle = undefined;
		const reasons = this.reasons;
		this.reasons = [];
		if (this.stopped) return;
		this.onFrame(reasons);
	}
}
