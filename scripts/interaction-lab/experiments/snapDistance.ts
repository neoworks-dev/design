import type { Point } from '../../lib/input';
import type { Experiment, Lab } from '../lab';
import { ISOLATED, isolateA, placeNode, selected } from './helpers';

// B sits below-right of A so that only A's right edge can meet B's left edge (at a canvas delta
// of +100); 150 px down keeps B on screen at every tested zoom, 600 px down puts it off screen.
const EDGE_DELTA = 100;

interface SweepStep {
	screenDelta: number;
	offset: number;
}

/** Moves the pointer 1 screen px at a time along x, from `from` to `to` px right of the press. */
async function sweep(lab: Lab, pressPoint: Point, from: number, to: number): Promise<SweepStep[]> {
	const steps: SweepStep[] = [];
	const direction = Math.sign(to - from);
	for (let screenDelta = from; screenDelta !== to + direction; screenDelta += direction) {
		const sample = await lab.moveTo({ x: pressPoint.x + screenDelta, y: pressPoint.y });
		const node = selected(sample, 'A');
		if (!node || !node.absolute) throw new Error('A dropped out of the selection');
		steps.push({ screenDelta, offset: node.absolute.x - ISOLATED.x });
	}
	return steps;
}

/** Screen distance from the snap position over which the node sat exactly at the edge. */
function snapRange(steps: SweepStep[], zoom: number): string {
	const snapped = steps.filter(
		(step) => step.offset === EDGE_DELTA && step.screenDelta / zoom !== EDGE_DELTA
	);
	if (snapped.length === 0) return 'never snapped';
	const distances = snapped.map((step) => step.screenDelta - EDGE_DELTA * zoom);
	return `snapped from ${Math.min(...distances)} to ${Math.max(...distances)} screen px around the edge`;
}

export async function measureSnap(
	lab: Lab,
	zoom: number,
	modifiers: string[],
	bOffsetY = 150
): Promise<{ forward: string; backward: string }> {
	await isolateA(lab, zoom);
	await placeNode(lab, 'B', ISOLATED.x + 200, ISOLATED.y + bOffsetY);
	const pressPoint = await lab.nodePoint('A');
	for (const name of modifiers) await lab.holdKey(name);
	await lab.press(pressPoint);
	const edge = EDGE_DELTA * zoom;
	const start = Math.round(edge - 15);
	await lab.moveTo({ x: pressPoint.x + start - 10, y: pressPoint.y }, { steps: 4 });
	const forward = await sweep(lab, pressPoint, start, Math.round(edge + 15));
	await lab.shot(`zoom-${zoom}${modifiers.join('-')}-at-edge+15`);
	const backward = await sweep(lab, pressPoint, Math.round(edge + 15), start);
	await lab.release();
	for (const name of modifiers) await lab.releaseKey(name);
	lab.note(
		`zoom ${zoom} ${modifiers.join('+')} forward: ${forward.map((step) => `${step.screenDelta}→${step.offset}`).join(' ')}`
	);
	return { forward: snapRange(forward, zoom), backward: snapRange(backward, zoom) };
}

export const snapDistance: Experiment = {
	name: 'snap-distance',
	question:
		'Edge snapping between siblings: how close (in screen px) must an edge come before it snaps, does it depend on zoom, is there hysteresis, and does an off-screen node still attract? (moving.md experiment 10)',
	async run(lab) {
		for (const zoom of [1, 0.5, 2, 4]) {
			const result = await measureSnap(lab, zoom, []);
			lab.result(`zoom ${zoom}, approaching`, result.forward);
			lab.result(`zoom ${zoom}, leaving`, result.backward);
		}
		const offscreen = await measureSnap(lab, 1, [], 600);
		lab.result('zoom 1, B below the viewport, approaching', offscreen.forward);
	}
};
