// Frame timing, identical in both targets: a requestAnimationFrame loop in the page records the
// interval between frames and, for every input event, how long until the next frame started.
// Main-thread frame cadence is what both Figma (wasm + WebGL) and our app (CanvasKit) paint on.

export const FRAME_RECORDER = `(() => {
	const recorder = { running: false, frames: [], latencies: [], pending: [], last: 0 };
	const INPUT_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown'];

	function onInput(event) {
		if (recorder.running) recorder.pending.push({ type: event.type, time: event.timeStamp });
	}

	function tick(now) {
		if (!recorder.running) return;
		if (recorder.last > 0) recorder.frames.push(now - recorder.last);
		recorder.last = now;
		// An input handled during a long frame (after its start, before this callback) belongs to
		// the next frame; only inputs that happened before this frame started are answered by it.
		const answered = recorder.pending.filter((input) => input.time <= now);
		for (const input of answered) recorder.latencies.push({ type: input.type, ms: now - input.time });
		recorder.pending = recorder.pending.filter((input) => input.time > now);
		requestAnimationFrame(tick);
	}

	window.__frameRecorder = {
		start() {
			recorder.running = true;
			recorder.frames = [];
			recorder.latencies = [];
			recorder.pending = [];
			recorder.last = 0;
			for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { capture: true, passive: true });
			requestAnimationFrame(tick);
		},
		stop() {
			recorder.running = false;
			for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true });
			return { frames: recorder.frames, latencies: recorder.latencies };
		}
	};
	return 'installed';
})()`;

export interface FrameRecording {
	frames: number[];
	latencies: Array<{ type: string; ms: number }>;
}

export interface FrameStats {
	frames: number;
	p50: number;
	p95: number;
	p99: number;
	max: number;
	/** Frames longer than one 60 Hz frame (16.7 ms) and than two (33.3 ms). */
	over16: number;
	over33: number;
	latencyP50: number | null;
	latencyP95: number | null;
	latencyMax: number | null;
}

export function summarize(recording: FrameRecording): FrameStats {
	const frames = [...recording.frames].sort((left, right) => left - right);
	const latencies = recording.latencies
		.map((entry) => entry.ms)
		.sort((left, right) => left - right);
	return {
		frames: frames.length,
		p50: percentile(frames, 0.5),
		p95: percentile(frames, 0.95),
		p99: percentile(frames, 0.99),
		max: percentile(frames, 1),
		over16: frames.filter((frame) => frame > 1000 / 60 + 1).length,
		over33: frames.filter((frame) => frame > 2000 / 60 + 1).length,
		latencyP50: percentileOrNull(latencies, 0.5),
		latencyP95: percentileOrNull(latencies, 0.95),
		latencyMax: percentileOrNull(latencies, 1)
	};
}

function percentile(sorted: number[], fraction: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
	return round(sorted[Math.max(0, index)]);
}

function percentileOrNull(sorted: number[], fraction: number): number | null {
	if (sorted.length === 0) return null;
	return percentile(sorted, fraction);
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}
