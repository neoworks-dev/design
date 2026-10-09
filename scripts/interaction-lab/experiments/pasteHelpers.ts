import type { Lab, PageNode, SceneNode, ViewportInfo } from '../lab';

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Observation {
	/** Nodes that exist after the action and not before, in document order. */
	created: PageNode[];
	/** Selected nodes after the action, as `name (new)` or `name (old)`. */
	selection: string[];
	before: ViewportInfo;
	after: ViewportInfo;
}

export function frame(
	name: string,
	x: number,
	y: number,
	width: number,
	height: number,
	children: SceneNode[] = []
): SceneNode {
	return { type: 'frame', name, x, y, width, height, children };
}

export function node(
	type: SceneNode['type'],
	name: string,
	x: number,
	y: number,
	width: number,
	height: number
): SceneNode {
	return { type, name, x, y, width, height };
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/** Runs `action` and reports what it created, what is selected and how the view moved. */
export async function observe(lab: Lab, action: () => Promise<unknown>): Promise<Observation> {
	const knownIds = new Set((await lab.pageNodes()).map((entry) => entry.id));
	const before = await lab.viewportInfo();
	await action();
	const nodes = await lab.pageNodes();
	const created = nodes.filter((entry) => !knownIds.has(entry.id));
	const selected = await lab.evaluate<{ selection: { id: string; name: string }[] }>(
		'__interactionLab.sample()'
	);
	const selection = selected.selection.map((entry) => {
		if (knownIds.has(entry.id)) return `${entry.name} (old)`;
		return `${entry.name} (new)`;
	});
	return { created, selection, before, after: await lab.viewportInfo() };
}

export function describeCreated(
	observation: Observation,
	origin: { x: number; y: number } = { x: 0, y: 0 }
): string {
	if (observation.created.length === 0) return 'nothing created';
	// Figma pastes and duplicates a main component as an instance; only the placement is compared.
	return observation.created
		.map(
			(entry) =>
				`${entry.name} ${entry.type === 'INSTANCE' ? 'COMPONENT' : entry.type} at ${round(entry.x - origin.x)},${round(entry.y - origin.y)} size ${round(entry.width)}x${round(entry.height)} in ${entry.parent}`
		)
		.join('; ');
}

export function describeSelection(observation: Observation): string {
	if (observation.selection.length === 0) return 'nothing selected';
	return observation.selection.join(', ');
}

/** Union of the boxes of every node the action created. */
function createdBounds(observation: Observation): Box | null {
	if (observation.created.length === 0) return null;
	const left = Math.min(...observation.created.map((entry) => entry.x));
	const top = Math.min(...observation.created.map((entry) => entry.y));
	const right = Math.max(...observation.created.map((entry) => entry.x + entry.width));
	const bottom = Math.max(...observation.created.map((entry) => entry.y + entry.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

const SAFE_MARGIN = 1 / 16;
const EDGE_TOLERANCE = 0.01;

/** Which safe-area edge the content was brought to along one axis, or "kept" when it did not move. */
function panEdge(
	start: number,
	end: number,
	viewStart: number,
	size: number,
	moved: boolean
): string {
	if (!moved) return 'kept';
	const startFraction = (start - viewStart) / size;
	const endFraction = (end - viewStart) / size;
	if (Math.abs(startFraction - SAFE_MARGIN) <= EDGE_TOLERANCE) return 'start at safe edge';
	if (Math.abs(endFraction - (1 - SAFE_MARGIN)) <= EDGE_TOLERANCE) return 'end at safe edge';
	return `at ${Math.round(startFraction * 100)}..${Math.round(endFraction * 100)} %`;
}

/**
 * How the view reacted, in terms that do not depend on the canvas size: unchanged; panned, with
 * the safe-area edge the content was brought to on each axis; or zoomed to fit, with the axis that
 * limited the zoom and its margin in screen pixels.
 */
export function describeView(observation: Observation): string {
	const { before, after } = observation;
	const content = createdBounds(observation);
	const ratio = round(after.zoom / before.zoom);
	const centreBefore = centreOf(before.bounds);
	const centreAfter = centreOf(after.bounds);
	const shiftedX = Math.abs(centreAfter.x - centreBefore.x) > 0.5;
	const shiftedY = Math.abs(centreAfter.y - centreBefore.y) > 0.5;
	if (ratio === 1 && !shiftedX && !shiftedY) return 'view unchanged';
	if (content === null) return `view changed (zoom x${ratio}) without content`;
	const view = after.bounds;
	if (ratio === 1) {
		const horizontal = panEdge(content.x, content.x + content.width, view.x, view.width, shiftedX);
		const vertical = panEdge(content.y, content.y + content.height, view.y, view.height, shiftedY);
		return `panned, horizontally ${horizontal}, vertically ${vertical}`;
	}
	const left = (content.x - view.x) * after.zoom;
	const top = (content.y - view.y) * after.zoom;
	const right = (view.x + view.width - content.x - content.width) * after.zoom;
	const widthLimited = Math.abs(left - right) <= 3 && left <= top;
	if (widthLimited) return `zoomed to fit, limited by width, margin ${Math.round(left)} px`;
	return `zoomed to fit, limited by height, margin ${Math.round(top)} px`;
}

export function centreOf(box: Box): { x: number; y: number } {
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Where a copy landed relative to the original and the view, in words both targets can agree on:
 * "in place", "right of original +40" (same y, left edge = original right + gap), "centred in
 * view", or the offset from the original.
 */
export function classify(copy: Box, original: Box, view: Box): string {
	const viewCentre = centreOf(view);
	const copyCentre = centreOf(copy);
	if (Math.abs(copyCentre.x - viewCentre.x) <= 1 && Math.abs(copyCentre.y - viewCentre.y) <= 1) {
		return 'centred in view';
	}
	const dx = round(copy.x - original.x);
	const dy = round(copy.y - original.y);
	if (dx === 0 && dy === 0) return 'in place';
	if (dy === 0) return `right of original, gap ${round(copy.x - (original.x + original.width))}`;
	return `offset ${dx},${dy}`;
}

/** Records created nodes, selection and view for one step as three measurements. */
export function record(
	lab: Lab,
	label: string,
	observation: Observation,
	origin: { x: number; y: number } = { x: 0, y: 0 }
): void {
	lab.result(`${label}: created`, describeCreated(observation, origin));
	lab.result(`${label}: selection`, describeSelection(observation));
	lab.result(`${label}: view`, describeView(observation));
}

/** Zoom and pan so the view has `centre` in the middle; returns the resulting view box. */
export async function showView(
	lab: Lab,
	zoom: number,
	centre: { x: number; y: number }
): Promise<Box> {
	await lab.setZoom(zoom, centre);
	const info = await lab.viewportInfo();
	return info.bounds;
}

/** The view box a zoom level has, independent of where it is looking. */
export async function viewSizeAt(
	lab: Lab,
	zoom: number
): Promise<{ width: number; height: number }> {
	const view = await showView(lab, zoom, { x: 0, y: 0 });
	return { width: view.width, height: view.height };
}
