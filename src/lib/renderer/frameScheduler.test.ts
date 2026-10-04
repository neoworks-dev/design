import { describe, expect, it } from 'vitest';
import { FrameScheduler, type FrameDriver } from './frameScheduler';

function manualDriver(): FrameDriver & { flush(): void; cancelled: number[]; queued: number } {
	let next = 1;
	const queue = new Map<number, () => void>();
	const cancelled: number[] = [];
	return {
		request(callback) {
			const handle = next;
			next += 1;
			queue.set(handle, callback);
			return handle;
		},
		cancel(handle) {
			cancelled.push(handle);
			queue.delete(handle);
		},
		flush() {
			const callbacks = [...queue.values()];
			queue.clear();
			for (const callback of callbacks) callback();
		},
		cancelled,
		get queued() {
			return queue.size;
		}
	};
}

describe('FrameScheduler', () => {
	it('turns any number of requests before the next frame into one frame with all reasons', () => {
		const driver = manualDriver();
		const frames: string[][] = [];
		const scheduler = new FrameScheduler(driver, (reasons) => frames.push(reasons));
		scheduler.request('scene');
		scheduler.request('viewport');
		scheduler.request('scene');
		expect(driver.queued).toBe(1);
		driver.flush();
		expect(frames).toEqual([['scene', 'viewport']]);
		expect(scheduler.isPending).toBe(false);
	});

	it('a request made while drawing schedules the following frame, not the current one', () => {
		const driver = manualDriver();
		const frames: string[][] = [];
		const scheduler = new FrameScheduler(driver, (reasons) => {
			frames.push(reasons);
			if (frames.length === 1) scheduler.request('follow-up');
		});
		scheduler.request('first');
		driver.flush();
		expect(driver.queued).toBe(1);
		driver.flush();
		expect(frames).toEqual([['first'], ['follow-up']]);
	});

	it('stop cancels the pending frame and ignores later requests', () => {
		const driver = manualDriver();
		const frames: string[][] = [];
		const scheduler = new FrameScheduler(driver, (reasons) => frames.push(reasons));
		scheduler.request('scene');
		scheduler.stop();
		expect(driver.cancelled).toHaveLength(1);
		scheduler.request('late');
		driver.flush();
		expect(frames).toEqual([]);
	});
});
