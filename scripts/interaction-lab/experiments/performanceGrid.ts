import { mouse, pressChord, type Point } from '../../lib/input';
import type { Experiment, Lab } from '../lab';
import { profileStage } from '../profile';

// COUNT squares of 8 px on a 10 px pitch in a 5:4 grid inside the frame "Perf grid" at the
// origin, so square i sits at (10 + 10·column, 10 + 10·row). The grid is fitted into the viewport:
// every square is on screen during every stage. Set by `perf --count` (PERF_COUNT); the default
// stays small because the Figma side runs in a real, synced file.
// Set when the run starts (the CLI sets PERF_COUNT after modules are imported).
let COUNT = 0;
let COLUMNS = 0;
let ROWS = 0;
let GRID = { width: 0, height: 0 };
let MIDDLE = { column: 0, row: 0 };
// A marquee over a fifth of the columns and half of the rows covers about a tenth of the squares.
let MARQUEE = { columns: 0, rows: 0 };

function configureGrid(): void {
	COUNT = readCount();
	COLUMNS = Math.round(Math.sqrt(COUNT * 1.25));
	ROWS = Math.ceil(COUNT / COLUMNS);
	GRID = { width: COLUMNS * 10 + 10, height: ROWS * 10 + 10 };
	MIDDLE = { column: Math.floor(COLUMNS / 2), row: Math.floor(ROWS / 2) };
	MARQUEE = { columns: Math.floor(COLUMNS / 5), rows: Math.floor(ROWS / 2) };
}

function readCount(): number {
	const configured = Number(process.env.PERF_COUNT);
	if (Number.isInteger(configured) && configured > 0) return configured;
	return 5000;
}

// `perf --skip drag-all` (PERF_SKIP): stages to leave out, comma separated.
function skipped(stage: string): boolean {
	const stages = (process.env.PERF_SKIP ?? '').split(',');
	return stages.includes(stage);
}

function squareCentre(column: number, row: number): { x: number; y: number } {
	return { x: 10 + column * 10 + 4, y: 10 + row * 10 + 4 };
}

// Raw input without the Lab's settle and sampling, so timings contain only the target's work.
async function rawClick(lab: Lab, point: Point): Promise<void> {
	await mouse(lab.cdp, 'mouseMoved', point, 'none', 0, 0);
	await mouse(lab.cdp, 'mousePressed', point, 'left', 1, 1);
	await mouse(lab.cdp, 'mouseReleased', point, 'left', 1, 0);
}

async function buildScene(lab: Lab): Promise<number> {
	const built = await lab.evaluate<{
		ms: number;
		zoom: number;
		firstFrames: number;
	}>(`(async () => {
		const result = await __interactionLab.buildPerfScene(${COUNT}, ${COLUMNS});
		const before = performance.now();
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		result.firstFrames = performance.now() - before;
		return result;
	})()`);
	lab.result(`build ${COUNT} squares through the API: ms`, Math.round(built.ms));
	lab.result('two frames after building: ms', Math.round(built.firstFrames));
	await lab.waitForStableViewport();
	return built.zoom;
}

async function fitGrid(lab: Lab, zoom: number): Promise<void> {
	await lab.setZoom(zoom, { x: GRID.width / 2, y: GRID.height / 2 });
}

async function measureIdle(lab: Lab): Promise<void> {
	await lab.startFrames();
	await lab.pause(3000);
	await lab.stopFrames('idle 3 s');
}

async function measureWheel(lab: Lab, zoom: number): Promise<void> {
	await lab.hover(await lab.canvasPoint(GRID.width / 2, GRID.height / 2));
	await lab.startFrames();
	await lab.wheelSeries(60, 0, 40);
	await lab.pause(300);
	await lab.stopFrames('wheel pan, 60 events');
	await fitGrid(lab, zoom);

	await lab.hover(await lab.canvasPoint(GRID.width / 2, GRID.height / 2));
	await lab.holdKey('Control');
	await lab.startFrames();
	await lab.wheelSeries(30, 0, -40);
	await lab.wheelSeries(30, 0, 40);
	await lab.pause(300);
	await lab.stopFrames('ctrl+wheel zoom, 60 events');
	await lab.releaseKey('Control');
	await fitGrid(lab, zoom);
}

async function measureSelectAndDragOne(lab: Lab): Promise<void> {
	const centre = squareCentre(MIDDLE.column, MIDDLE.row);
	const point = await lab.canvasPoint(centre.x, centre.y);
	await lab.tap('Escape');
	await lab.pause(800);
	await lab.timeTo(
		'click one square',
		() => rawClick(lab, point),
		'__interactionLab.selectionCount() === 1'
	);
	await lab.pause(800);
	await lab.startFrames();
	await timedDrag(lab, point, { x: 60, y: 30 }, 30, 'drag one square, 30 moves');
	await lab.stopFrames('drag one square, 30 moves');
	if (process.env.PERF_PROFILE === '1') {
		await lab.tap('Control+z');
		await lab.pause(800);
		await profileDrag(lab, point, 'drag-one-square', 30);
	}
	await lab.tap('Control+z');
}

async function measureMarquee(lab: Lab): Promise<void> {
	await lab.tap('Escape');
	await lab.pause(800);
	// From outside the grid's top-left corner over about a tenth of the squares.
	const corner = squareCentre(MARQUEE.columns - 1, MARQUEE.rows - 1);
	await lab.startFrames();
	await lab.press(await lab.canvasPoint(-40, -40));
	await lab.moveTo(await lab.canvasPoint(corner.x + 5, corner.y + 5), { steps: 30 });
	await lab.release();
	await lab.stopFrames(`marquee over ${MARQUEE.columns * MARQUEE.rows} squares, 30 moves`);
	lab.result('marquee selected', await lab.evaluate<number>('__interactionLab.selectionCount()'));
}

async function measureSelectAllAndDrag(lab: Lab): Promise<void> {
	await lab.tap('Escape');
	await lab.pause(800);
	const centre = squareCentre(MIDDLE.column, MIDDLE.row);
	const point = await lab.canvasPoint(centre.x, centre.y);
	await rawClick(lab, point);
	await lab.settle(4);
	await lab.timeTo(
		'Ctrl+A with one square selected',
		() => pressChord(lab.cdp, 'Control+a'),
		'__interactionLab.selectionCount() > 1',
		60000
	);
	lab.result('Ctrl+A selected', await lab.evaluate<number>('__interactionLab.selectionCount()'));
	await lab.pause(800);
	await lab.startFrames();
	await timedDrag(lab, point, { x: 50, y: 0 }, 20, 'drag all selected, 20 moves');
	await lab.stopFrames('drag all selected, 20 moves');
	if (process.env.PERF_PROFILE === '1') {
		await lab.pause(800);
		await profileDrag(lab, point, 'drag-all-selected', 10);
	}
}

/**
 * A drag with raw input, timing every move from dispatch until the next frame has started: what
 * a person feels per pointer move. Frame percentiles hide this when a long drag has many idle
 * frames (20 slow moves among 1 700 frames at 130 Hz stay under the 95th percentile).
 */
async function timedDrag(
	lab: Lab,
	from: Point,
	delta: Point,
	steps: number,
	label: string
): Promise<void> {
	const moves: number[] = [];
	const started = Date.now();
	await mouse(lab.cdp, 'mouseMoved', from, 'none', 0, 0);
	await mouse(lab.cdp, 'mousePressed', from, 'left', 1, 1);
	for (let step = 1; step <= steps; step += 1) {
		const point = {
			x: from.x + (delta.x * step) / steps,
			y: from.y + (delta.y * step) / steps
		};
		const before = Date.now();
		await mouse(lab.cdp, 'mouseMoved', point, 'left', 0, 1);
		await lab.settle(1);
		moves.push(Date.now() - before);
	}
	const end = { x: from.x + delta.x, y: from.y + delta.y };
	const releasing = Date.now();
	await mouse(lab.cdp, 'mouseReleased', end, 'left', 1, 0);
	await lab.settle(1);
	const released = Date.now() - releasing;
	const sorted = [...moves].sort((left, right) => left - right);
	lab.result(`${label}: per move p50 ms`, sorted[Math.floor(sorted.length / 2)]);
	lab.result(`${label}: per move max ms`, sorted[sorted.length - 1]);
	lab.result(`${label}: release ms`, released);
	lab.result(`${label}: wall ms`, Date.now() - started);
}

// A second, profiled drag (after the timed one, so profiling costs no measured time).
async function profileDrag(lab: Lab, point: Point, label: string, moves: number): Promise<void> {
	const hotspots = await profileStage(lab.cdp, lab.outputDirectory, label, async () => {
		await lab.press(point);
		await lab.moveBy(0, 30, { steps: moves });
		await lab.release();
	});
	for (const hotspot of hotspots) {
		lab.note(
			`profile ${label}: ${hotspot.share}% ${hotspot.selfMs} ms ${hotspot.name} (${hotspot.location})`
		);
	}
}

export const performanceGrid: Experiment = {
	name: 'performance-grid',
	kind: 'performance',
	question:
		'With a grid of squares in the viewport (5 000 by default, `perf --count`): build time, frame times and input→frame latency while idle, wheel-panning, zooming, dragging one square, marqueeing a tenth of them, and selecting and dragging all of them.',
	async run(lab) {
		configureGrid();
		lab.sampling = 'count';
		const zoom = await buildScene(lab);
		await lab.shot('scene');
		try {
			await measureIdle(lab);
			await measureWheel(lab, zoom);
			await measureSelectAndDragOne(lab);
			await measureMarquee(lab);
			await lab.shot('after-marquee');
			if (!skipped('drag-all')) {
				await measureSelectAllAndDrag(lab);
				await lab.shot('after-drag-all');
			}
		} finally {
			await lab.releaseEverything();
			await lab.evaluate('__interactionLab.clearPerfScene()');
		}
	}
};
