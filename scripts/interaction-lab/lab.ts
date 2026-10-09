// Drives one target (Figma or our app) over CDP for repeatable interaction experiments. Input is
// real CDP mouse/key events; state is read through the page's `__interactionLab` helpers, which
// each target implements on its own API. Every input is followed by a sample of the selection,
// so a run produces a trace of exactly what the target did after each event.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CdpSession } from '../lib/cdp';
import {
	holdModifiers,
	keyDown,
	keyUp,
	mouse,
	pressChord,
	scroll,
	type EditingCommand,
	type Point
} from '../lib/input';
import { FRAME_RECORDER, summarize, type FrameRecording, type FrameStats } from './frames';
import type { Target } from './targets';

export interface NodeState {
	id: string;
	name: string;
	type: string;
	x: number;
	y: number;
	width: number;
	height: number;
	absolute: { x: number; y: number; width: number; height: number } | null;
	parent: { id: string; name: string; type: string } | null;
	index: number;
}

export interface Sample {
	label: string;
	pointer: Point | null;
	pointerCanvas: Point | null;
	buttonDown: boolean;
	modifiers: string[];
	selection: NodeState[];
	shot: string | null;
}

export interface Experiment {
	name: string;
	question: string;
	/** 'performance' experiments report timings side by side instead of pass/fail parity. */
	kind?: 'parity' | 'performance';
	run: (lab: Lab) => Promise<void>;
}

/** One named measurement; comparisons match Figma and app results by `key`. */
export interface Result {
	key: string;
	value: string;
}

/**
 * One node of a scene built by `resetToScene`. Children of a frame or component are positioned
 * relative to it; the members of a group are positioned in the group's parent and the group is
 * fitted to them (its own x, y, width and height are ignored).
 */
export interface SceneNode {
	type: 'frame' | 'rectangle' | 'text' | 'component' | 'group';
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** Degrees, about the top-left corner. */
	rotation?: number;
	children?: SceneNode[];
}

/** A node on the lab page with its absolute box; `parent` is the parent's name or "PAGE". */
export interface PageNode {
	id: string;
	name: string;
	type: string;
	parent: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ViewportInfo {
	zoom: number;
	bounds: { x: number; y: number; width: number; height: number };
}

export type Anchor = 'center' | 'tl' | 't' | 'tr' | 'l' | 'r' | 'bl' | 'b' | 'br';

export interface MoveOptions {
	steps?: number;
	shot?: string;
}

export class Lab {
	readonly cdp: CdpSession;
	readonly outputDirectory: string;
	readonly samples: Sample[] = [];
	readonly notes: string[] = [];
	readonly results: Result[] = [];
	private pointer: Point | null = null;
	private buttonDown = false;
	private modifiers: string[] = [];
	private shotCounter = 0;

	readonly target: Target;

	private constructor(cdp: CdpSession, target: Target, outputDirectory: string) {
		this.cdp = cdp;
		this.target = target;
		this.outputDirectory = outputDirectory;
	}

	static async connect(target: Target, outputDirectory: string): Promise<Lab> {
		const cdp = await CdpSession.connect(target.port(), target.matches);
		const lab = new Lab(cdp, target, outputDirectory);
		await cdp.send('Page.bringToFront');
		await lab.allowClipboardAccess();
		await lab.installHelpers();
		await lab.watchForReload();
		return lab;
	}

	// "Paste here" in Figma's context menu reads the clipboard through the async clipboard API, which
	// waits on a permission prompt nobody can answer in a lab browser.
	private async allowClipboardAccess(): Promise<void> {
		try {
			await this.cdp.send('Browser.grantPermissions', {
				permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
			});
		} catch (error) {
			this.notes.push(`could not grant clipboard permissions: ${String(error)}`);
		}
	}

	/** True once the page navigated or reloaded after connecting (e.g. a Vite full reload). */
	reloaded = false;

	/**
	 * 'full' samples describe every selected node after each input; 'count' only counts them, for
	 * performance runs where describing 50k selected nodes would itself cost frames.
	 */
	sampling: 'full' | 'count' = 'full';

	// A reload throws away the open file and `__interactionLab`; the run is worthless after it.
	private async watchForReload(): Promise<void> {
		await this.cdp.send('Page.enable');
		this.cdp.on('Page.frameNavigated', (params) => {
			const frame = params.frame as { parentId?: string } | undefined;
			if (frame && frame.parentId === undefined) this.reloaded = true;
		});
	}

	async installHelpers(): Promise<void> {
		await this.waitUntilReady();
		await this.cdp.evaluate(this.target.helpers);
	}

	// Figma's `figma` global and our debug surface both appear seconds after the page opens.
	private async waitUntilReady(): Promise<void> {
		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			const ready = await this.cdp.evaluate(this.target.ready);
			if (ready === true) return;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		throw new Error(`${this.target.name} is not ready for the lab after 60 s`);
	}

	/**
	 * Lab page, emptied, with the standard fixture (A, B, Frame > C, Stack > S1..S3) at zoom 100 %,
	 * the move tool active and keyboard focus on the canvas (a click on empty canvas at 200,200).
	 */
	async resetToFixture(): Promise<void> {
		await this.releaseEverything();
		await this.cdp.evaluate('__interactionLab.resetLab()');
		await this.waitForStableViewport();
		await this.click(await this.canvasPoint(200, 200));
		await this.tap('Escape');
		await this.tap('v');
		await this.settle(4);
	}

	/**
	 * Lab page, emptied, holding exactly `scene` (no fixture) at zoom 100 % around (400, 300), the
	 * move tool active, nothing selected, keyboard focus on the canvas.
	 */
	async resetToScene(scene: SceneNode[]): Promise<void> {
		await this.releaseEverything();
		await this.cdp.evaluate(`__interactionLab.resetLab(${JSON.stringify(scene)})`);
		await this.waitForStableViewport();
		await this.click(await this.canvasPoint(200, 200));
		await this.tap('Escape');
		await this.tap('v');
		await this.settle(4);
	}

	/** Switches to a second, empty-or-scene page ("CDP lab 2") and shows it at zoom 100 %. */
	async openScratchPage(scene: SceneNode[] = []): Promise<void> {
		await this.cdp.evaluate(`__interactionLab.openScratchPage(${JSON.stringify(scene)})`);
		await this.waitForStableViewport();
		await this.settle(4);
	}

	/** Back to the lab page; the second page is deleted. */
	async closeScratchPage(): Promise<void> {
		await this.cdp.evaluate('__interactionLab.closeScratchPage()');
		await this.waitForStableViewport();
	}

	async pageNodes(): Promise<PageNode[]> {
		return this.evaluate<PageNode[]>('__interactionLab.listNodes()');
	}

	async viewportInfo(): Promise<ViewportInfo> {
		return this.evaluate<ViewportInfo>('__interactionLab.viewportInfo()');
	}

	/** Real time passing, e.g. to keep consecutive presses from counting as a double-click. */
	async pause(milliseconds: number): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, milliseconds));
	}

	async evaluate<Value>(expression: string): Promise<Value> {
		const value = await this.cdp.evaluate(expression);
		return value as Value;
	}

	async setZoom(zoom: number, center: Point = { x: 400, y: 300 }): Promise<void> {
		await this.cdp.evaluate(`__interactionLab.setViewport(${zoom}, ${JSON.stringify(center)})`);
		await this.waitForStableViewport();
	}

	/** Figma eases viewport changes; a press during the easing lands on the wrong canvas point. */
	async waitForStableViewport(): Promise<void> {
		await this.cdp.evaluate(`new Promise((resolve, reject) => {
			const deadline = performance.now() + 3000;
			let previous = '';
			let stableFrames = 0;
			const tick = () => {
				const current = __interactionLab.viewportKey();
				if (current === previous) stableFrames += 1;
				else stableFrames = 0;
				previous = current;
				if (stableFrames >= 5) return resolve(true);
				if (performance.now() > deadline) return reject(new Error('viewport kept moving for 3s'));
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		})`);
	}

	/** Sets the selection programmatically (Figma plugin API / our selection service). */
	async select(names: string[]): Promise<void> {
		await this.cdp.evaluate(`__interactionLab.select(${JSON.stringify(names)})`);
		await this.settle();
	}

	/** Selects like a user: Escape, click the first node, Shift-click the rest. */
	async selectByClicking(names: string[]): Promise<Sample> {
		await this.tap('Escape');
		const [first, ...rest] = names;
		let sample = await this.click(await this.nodePoint(first));
		if (rest.length === 0) return sample;
		await this.holdKey('Shift');
		for (const name of rest) sample = await this.click(await this.nodePoint(name));
		await this.releaseKey('Shift');
		return sample;
	}

	async node(name: string): Promise<NodeState> {
		return this.evaluate<NodeState>(`__interactionLab.describe(${JSON.stringify(name)})`);
	}

	/** Moves a node (relative to its parent) through the target's API, not through input. */
	async placeNode(name: string, x: number, y: number): Promise<void> {
		await this.cdp.evaluate(`__interactionLab.placeNode(${JSON.stringify(name)}, ${x}, ${y})`);
		await this.settle();
	}

	async pageChildren(): Promise<string[]> {
		return this.evaluate<string[]>('__interactionLab.pageChildren()');
	}

	/** Closes the target's open undo entry, so setup edits do not merge with the next action. */
	async commitUndo(): Promise<void> {
		await this.cdp.evaluate('__interactionLab.commitUndo()');
	}

	/** Undo entries on the stack, where the target can tell (null for Figma). */
	async undoDepth(): Promise<number | null> {
		return this.evaluate<number | null>('__interactionLab.undoDepth()');
	}

	/** Client point of a node anchor, optionally offset in screen pixels. */
	async nodePoint(
		name: string,
		anchor: Anchor = 'center',
		offset: Point = { x: 0, y: 0 }
	): Promise<Point> {
		const point = await this.evaluate<Point>(
			`__interactionLab.nodePoint(${JSON.stringify(name)}, ${JSON.stringify(anchor)})`
		);
		return { x: point.x + offset.x, y: point.y + offset.y };
	}

	async canvasPoint(x: number, y: number): Promise<Point> {
		return this.evaluate<Point>(`__interactionLab.toClient(${JSON.stringify({ x, y })})`);
	}

	/** Canvas coordinates under a client point. */
	async toCanvas(point: Point): Promise<Point> {
		return this.evaluate<Point>(`__interactionLab.toCanvas(${JSON.stringify(point)})`);
	}

	async hover(point: Point): Promise<void> {
		this.pointer = point;
		await mouse(this.cdp, 'mouseMoved', point, 'none', 0, 0);
		await this.settle();
	}

	async press(point: Point, shot?: string): Promise<Sample> {
		await this.hover(point);
		this.buttonDown = true;
		await mouse(this.cdp, 'mousePressed', point, 'left', 1, 1);
		await this.settle();
		return this.sample('press', shot);
	}

	/** Moves the pointer in `steps` equal increments, sampling after each one. */
	async moveTo(target: Point, options: MoveOptions = {}): Promise<Sample> {
		const start = this.requirePointer();
		const steps = options.steps || 1;
		let last: Sample | null = null;
		for (let step = 1; step <= steps; step += 1) {
			const progress = step / steps;
			const point = {
				x: start.x + (target.x - start.x) * progress,
				y: start.y + (target.y - start.y) * progress
			};
			last = await this.moveOnce(point, step === steps ? options.shot : undefined);
		}
		if (!last) throw new Error('moveTo needs at least one step');
		return last;
	}

	async moveBy(deltaX: number, deltaY: number, options: MoveOptions = {}): Promise<Sample> {
		const start = this.requirePointer();
		return this.moveTo({ x: start.x + deltaX, y: start.y + deltaY }, options);
	}

	async release(shot?: string): Promise<Sample> {
		const point = this.requirePointer();
		this.buttonDown = false;
		await mouse(this.cdp, 'mouseReleased', point, 'left', 1, 0);
		await this.settle(3);
		return this.sample('release', shot);
	}

	async click(point: Point, clickCount = 1): Promise<Sample> {
		await this.hover(point);
		for (let count = 1; count <= clickCount; count += 1) {
			await mouse(this.cdp, 'mousePressed', point, 'left', count, 1);
			await mouse(this.cdp, 'mouseReleased', point, 'left', count, 0);
		}
		await this.settle(3);
		return this.sample(`click x${clickCount}`);
	}

	/** Holds a modifier: real keydown (Figma tracks key state) plus the bit on later mouse events. */
	async holdKey(name: string, shot?: string): Promise<Sample> {
		this.modifiers = [...this.modifiers.filter((held) => held !== name), name];
		holdModifiers(this.modifiers);
		await keyDown(this.cdp, name);
		await this.nudgePointer();
		return this.sample(`keydown ${name}`, shot);
	}

	async releaseKey(name: string, shot?: string): Promise<Sample> {
		this.modifiers = this.modifiers.filter((held) => held !== name);
		holdModifiers(this.modifiers);
		await keyUp(this.cdp, name);
		await this.nudgePointer();
		return this.sample(`keyup ${name}`, shot);
	}

	/** Mouse wheel at the pointer (a trackpad-less pan in both apps). */
	async wheel(deltaX: number, deltaY: number, shot?: string): Promise<Sample> {
		await scroll(this.cdp, this.requirePointer(), deltaY, deltaX);
		await this.settle(3);
		return this.sample(`wheel ${deltaX},${deltaY}`, shot);
	}

	async tap(chord: string, shot?: string): Promise<Sample> {
		await pressChord(this.cdp, chord);
		await this.settle(2);
		return this.sample(`tap ${chord}`, shot);
	}

	/** Ctrl+C / Ctrl+X / Ctrl+V with Chromium's editing command, so clipboard events fire. */
	async copy(): Promise<void> {
		await this.clipboardChord('Control+c', 'copy');
	}

	async cut(): Promise<void> {
		await this.clipboardChord('Control+x', 'cut');
	}

	async paste(): Promise<Sample> {
		await this.clipboardChord('Control+v', 'paste');
		await this.settleAfterClipboard();
		return this.sample('paste');
	}

	/** Ctrl+D; the copy is selected afterwards. */
	async duplicate(): Promise<Sample> {
		await pressChord(this.cdp, 'Control+d');
		await this.settleAfterClipboard();
		return this.sample('duplicate');
	}

	/** Right-clicks `point` and picks the menu entry with this text (e.g. "Paste here"). */
	async contextMenuPick(point: Point, label: string): Promise<Sample> {
		await this.hover(point);
		await mouse(this.cdp, 'mousePressed', point, 'right', 1, 2);
		await mouse(this.cdp, 'mouseReleased', point, 'right', 1, 0);
		const item = await this.waitForMenuItem(label);
		await this.click(item);
		await this.settleAfterClipboard();
		return this.sample(`menu ${label}`);
	}

	private async waitForMenuItem(label: string): Promise<Point> {
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			await this.settle(4);
			const item = await this.evaluate<Point | null>(
				`__interactionLab.findMenuItem(${JSON.stringify(label)})`
			);
			if (item) return item;
		}
		throw new Error(`no context menu entry "${label}" after 5 s`);
	}

	private async clipboardChord(chord: string, command: EditingCommand): Promise<void> {
		await pressChord(this.cdp, chord, [command]);
		await this.settleAfterClipboard();
	}

	// Paste reads the OS clipboard asynchronously, and both targets then animate the view.
	private async settleAfterClipboard(): Promise<void> {
		await this.pause(400);
		await this.settle(4);
		await this.waitForStableViewport();
	}

	async sample(label: string, shot?: string): Promise<Sample> {
		if (this.sampling === 'count') return this.countSample(label, shot);
		const snapshot = await this.evaluate<{ selection: NodeState[] }>('__interactionLab.sample()');
		let pointerCanvas: Point | null = null;
		if (this.pointer) {
			pointerCanvas = await this.evaluate<Point>(
				`__interactionLab.toCanvas(${JSON.stringify(this.pointer)})`
			);
		}
		let shotFile: string | null = null;
		if (shot) shotFile = await this.shot(shot);
		const sample: Sample = {
			label,
			pointer: this.pointer,
			pointerCanvas,
			buttonDown: this.buttonDown,
			modifiers: [...this.modifiers],
			selection: snapshot.selection,
			shot: shotFile
		};
		this.samples.push(sample);
		return sample;
	}

	private async countSample(label: string, shot?: string): Promise<Sample> {
		const count = await this.evaluate<number>('__interactionLab.selectionCount()');
		let shotFile: string | null = null;
		if (shot) shotFile = await this.shot(shot);
		const sample: Sample = {
			label: `${label} (${count} selected)`,
			pointer: this.pointer,
			pointerCanvas: null,
			buttonDown: this.buttonDown,
			modifiers: [...this.modifiers],
			selection: [],
			shot: shotFile
		};
		this.samples.push(sample);
		return sample;
	}

	// ---------- performance ----------

	async startFrames(): Promise<void> {
		await this.cdp.evaluate(FRAME_RECORDER);
		await this.cdp.evaluate('__frameRecorder.start()');
	}

	/** Stops recording and records frame and input-latency statistics as `<label>: <metric>`. */
	async stopFrames(label: string): Promise<FrameStats> {
		const recording = await this.evaluate<FrameRecording>('__frameRecorder.stop()');
		const stats = summarize(recording);
		this.result(`${label}: frames`, stats.frames);
		this.result(`${label}: frame p50 ms`, stats.p50);
		this.result(`${label}: frame p95 ms`, stats.p95);
		this.result(`${label}: frame max ms`, stats.max);
		this.result(`${label}: frames over 16.7 ms`, stats.over16);
		this.result(`${label}: frames over 33.3 ms`, stats.over33);
		this.result(`${label}: input→next frame p50 ms`, String(stats.latencyP50));
		this.result(`${label}: input→next frame p95 ms`, String(stats.latencyP95));
		return stats;
	}

	/**
	 * Time to interaction: from just before `action` dispatches its input until `condition` (a page
	 * expression) holds and one more frame has started, i.e. the result can be on screen. Polls the
	 * condition every animation frame inside the page, so the measurement is in page time.
	 */
	async timeTo(
		label: string,
		action: () => Promise<unknown>,
		condition: string,
		timeout = 30000
	): Promise<number> {
		await this.cdp.evaluate(`window.__timeToStart = performance.now()`);
		await action();
		const elapsed = await this.evaluate<number>(`new Promise((resolve, reject) => {
			const deadline = performance.now() + ${timeout};
			const check = () => {
				if (${condition}) return requestAnimationFrame(() => resolve(performance.now() - window.__timeToStart));
				if (performance.now() > deadline) return reject(new Error(${JSON.stringify(`timed out: ${label}`)}));
				requestAnimationFrame(check);
			};
			check();
		})`);
		this.result(`${label}: time to interaction ms`, Math.round(elapsed));
		return elapsed;
	}

	/** Mouse wheel events at a steady pace (one per frame at 60 Hz), at the pointer. */
	async wheelSeries(count: number, deltaX: number, deltaY: number, intervalMs = 16): Promise<void> {
		const point = this.requirePointer();
		for (let index = 0; index < count; index += 1) {
			await scroll(this.cdp, point, deltaY, deltaX);
			await this.pause(intervalMs);
		}
	}

	/**
	 * Where the selection outline is drawn relative to a node's fill, from pixels: the browser
	 * decodes a screenshot of the area around the node and finds the bounding boxes of the fill
	 * colour and of selection-blue pixels. "aligned" when their top-left corners agree.
	 */
	async outlineAlignment(name: string, fill: Rgb, margin = 160): Promise<string> {
		const node = await this.node(name);
		if (!node.absolute) return 'node has no bounds';
		const topLeft = await this.canvasPoint(node.absolute.x, node.absolute.y);
		const bottomRight = await this.canvasPoint(
			node.absolute.x + node.absolute.width,
			node.absolute.y + node.absolute.height
		);
		const clip = {
			x: Math.max(0, Math.floor(topLeft.x - margin)),
			y: Math.max(0, Math.floor(topLeft.y - margin)),
			width: Math.ceil(bottomRight.x - topLeft.x + margin * 2),
			height: Math.ceil(bottomRight.y - topLeft.y + margin * 2),
			scale: 1
		};
		const { data } = await this.cdp.send<{ data: string }>('Page.captureScreenshot', {
			format: 'png',
			clip
		});
		const boxes = await this.evaluate<PixelBoxes>(
			`(${findColourBoxes.toString()})(${JSON.stringify(data)}, ${JSON.stringify(fill)})`
		);
		return describeAlignment(boxes);
	}

	/** Screenshot of the whole tab (canvas and panels), numbered in run order. */
	async shot(label: string): Promise<string> {
		this.shotCounter += 1;
		const safeLabel = label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
		const fileName = `${String(this.shotCounter).padStart(2, '0')}-${safeLabel}.png`;
		const { data } = await this.cdp.send<{ data: string }>('Page.captureScreenshot', {
			format: 'png'
		});
		writeFileSync(path.join(this.outputDirectory, fileName), Buffer.from(data, 'base64'));
		return fileName;
	}

	note(text: string): void {
		this.notes.push(text);
	}

	result(key: string, value: unknown): void {
		let text = String(value);
		if (typeof value === 'object') text = JSON.stringify(value);
		this.results.push({ key, value: text });
	}

	/** Waits for Figma to process input and paint: a number of animation frames in the tab. */
	async settle(frames = 2): Promise<void> {
		await this.cdp.evaluate(
			`new Promise((resolve) => { let left = ${frames}; const tick = () => { left -= 1; if (left <= 0) resolve(true); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); })`
		);
	}

	/** Leaves no button or key held, so a failed experiment can't poison the next one. */
	async releaseEverything(): Promise<void> {
		if (this.buttonDown && this.pointer) {
			await mouse(this.cdp, 'mouseReleased', this.pointer, 'left', 1, 0);
		}
		this.buttonDown = false;
		for (const name of this.modifiers) await keyUp(this.cdp, name);
		this.modifiers = [];
		holdModifiers([]);
	}

	close(): void {
		this.cdp.close();
	}

	private async moveOnce(point: Point, shot?: string): Promise<Sample> {
		this.pointer = point;
		await this.dispatchMove(point);
		await this.settle();
		return this.sample(`move ${formatPoint(point)}`, shot);
	}

	// Figma re-evaluates modifiers on the next pointer event; a zero-distance move delivers one.
	private async nudgePointer(): Promise<void> {
		if (this.pointer) await this.dispatchMove(this.pointer);
		await this.settle();
	}

	private async dispatchMove(point: Point): Promise<void> {
		if (this.buttonDown) {
			await mouse(this.cdp, 'mouseMoved', point, 'left', 0, 1);
			return;
		}
		await mouse(this.cdp, 'mouseMoved', point, 'none', 0, 0);
	}

	private requirePointer(): Point {
		if (!this.pointer) throw new Error('pointer position unknown: hover or press first');
		return this.pointer;
	}
}

export function formatPoint(point: Point): string {
	return `${round(point.x)},${round(point.y)}`;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

export function prepareOutputDirectory(directory: string): void {
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(directory, { recursive: true });
}

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

interface PixelBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface PixelBoxes {
	fill: PixelBox | null;
	outline: PixelBox | null;
}

// Compares top-left corners: Figma draws a size label below the selection and the cursor sits to
// its right, both in selection blue, so centres drift; handles add up to ~5 px around corners.
const CORNER_TOLERANCE = 6;

function describeAlignment(boxes: PixelBoxes): string {
	if (!boxes.fill) return 'fill not visible';
	if (!boxes.outline) return 'no outline';
	const deltaX = boxes.outline.x - boxes.fill.x;
	const deltaY = boxes.outline.y - boxes.fill.y;
	if (Math.abs(deltaX) <= CORNER_TOLERANCE && Math.abs(deltaY) <= CORNER_TOLERANCE)
		return 'aligned';
	return `outline corner offset ${Math.round(deltaX)},${Math.round(deltaY)} px from the fill`;
}

// Runs in the page (stringified): decodes the PNG with the browser and scans its pixels.
async function findColourBoxes(base64: string, fill: Rgb): Promise<PixelBoxes> {
	const image = new Image();
	image.src = `data:image/png;base64,${base64}`;
	await image.decode();
	const canvas = document.createElement('canvas');
	canvas.width = image.width;
	canvas.height = image.height;
	const context = canvas.getContext('2d');
	if (!context) return { fill: null, outline: null };
	context.drawImage(image, 0, 0);
	const pixels = context.getImageData(0, 0, image.width, image.height).data;
	const fillBox = { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 };
	const outlineBox = { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 };
	const grow = (box: typeof fillBox, x: number, y: number): void => {
		box.minX = Math.min(box.minX, x);
		box.minY = Math.min(box.minY, y);
		box.maxX = Math.max(box.maxX, x);
		box.maxY = Math.max(box.maxY, y);
	};
	for (let y = 0; y < image.height; y += 1) {
		for (let x = 0; x < image.width; x += 1) {
			const offset = (y * image.width + x) * 4;
			const red = pixels[offset];
			const green = pixels[offset + 1];
			const blue = pixels[offset + 2];
			const isFill =
				Math.abs(red - fill.r) <= 12 &&
				Math.abs(green - fill.g) <= 12 &&
				Math.abs(blue - fill.b) <= 12;
			if (isFill) grow(fillBox, x, y);
			const isSelectionBlue = blue >= 200 && red <= 110 && blue - red >= 120 && !isFill;
			if (isSelectionBlue) grow(outlineBox, x, y);
		}
	}
	const toBox = (box: typeof fillBox): PixelBox | null => {
		if (box.maxX < 0) return null;
		return {
			x: box.minX,
			y: box.minY,
			width: box.maxX - box.minX + 1,
			height: box.maxY - box.minY + 1
		};
	};
	return { fill: toBox(fillBox), outline: toBox(outlineBox) };
}
