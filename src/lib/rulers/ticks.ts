// Ruler ticks, pure (#72). Ticks sit on whole page coordinates; the spacing adapts to the zoom so
// labelled ticks stay about `MIN_LABEL_GAP_PIXELS` apart and minor ticks never crowd.

export interface RulerTick {
	/** Page coordinate. */
	position: number;
	/** Labelled tick (longer line). */
	major: boolean;
}

export const MIN_LABEL_GAP_PIXELS = 60;
export const MIN_MINOR_GAP_PIXELS = 6;

const STEP_FACTORS = [1, 2, 5];

/** The smallest 1-2-5 step (in page units) whose screen length reaches `minimumPixels`. */
export function niceStep(scale: number, minimumPixels: number): number {
	const wanted = minimumPixels / scale;
	let magnitude = 10 ** Math.floor(Math.log10(wanted));
	// Below 1 unit ticks stop being whole page coordinates, which is the pixel grid's job.
	if (magnitude < 1) magnitude = 1;
	for (;;) {
		for (const factor of STEP_FACTORS) {
			const step = factor * magnitude;
			if (step >= wanted) return step;
		}
		magnitude *= 10;
	}
}

/**
 * Ticks for page coordinates `from` to `to` at `scale` screen pixels per unit. Major ticks fall on
 * multiples of the label step; minor ticks subdivide it while they stay `MIN_MINOR_GAP_PIXELS` apart.
 */
export function rulerTicks(from: number, to: number, scale: number): RulerTick[] {
	const majorStep = niceStep(scale, MIN_LABEL_GAP_PIXELS);
	const minorStep = minorStepFor(majorStep, scale);
	const ticks: RulerTick[] = [];
	const first = Math.ceil(from / minorStep);
	const last = Math.floor(to / minorStep);
	for (let index = first; index <= last; index += 1) {
		const position = index * minorStep;
		ticks.push({ position, major: isMultiple(position, majorStep) });
	}
	return ticks;
}

function isMultiple(position: number, step: number): boolean {
	return Math.abs(position / step - Math.round(position / step)) < 1e-9;
}

function minorStepFor(majorStep: number, scale: number): number {
	for (const divisor of [10, 5, 2]) {
		const step = majorStep / divisor;
		if (step >= 1 && step * scale >= MIN_MINOR_GAP_PIXELS && Number.isInteger(step)) return step;
	}
	return majorStep;
}
