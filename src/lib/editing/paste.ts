// Planning for paste (docs/research/interactions.md section 12). Pure: payload and document in,
// change list out.
//
// Where the pasted nodes go (parent and z-position):
//   - nothing selected: the current page, on top;
//   - a frame, section or component selected: inside it, on top;
//   - anything else selected: its parent (climbing past instances), right above the selection.
// Replace takes the selection's place and removes it.
//
// Where they land (absolute position of the pasted bounds), as measured in Figma (docs/research/
// figma-client/paste.md, "Measured"):
//   - paste in place: exactly where they were copied from;
//   - paste here: the top left on the cursor;
//   - replace: centred on the replaced nodes;
//   - one top-level frame with nothing or that frame (or one of its size) selected, original in
//     view: next to the original, pushed right past whatever it would overlap;
//   - into a frame: the same position when it touches the frame, else centred (per axis, in the
//     visible part of the frame);
//   - onto a page: the original position while the original is in view, else the view centre.
// Pasting also reports where the content went and how the view should follow (pasteView.ts).

import {
	canHaveChildren,
	composeMatrices,
	createNode,
	generateNodeId,
	invertMatrix,
	keysBetween,
	lookup,
	planEntityAdd,
	planInsertAll,
	planRemove,
	remapReferences,
	type Change,
	type DocumentReader,
	type EntityMap,
	type IdGenerator,
	type ImagePaint,
	type Matrix2x3,
	type Node,
	type NodeId,
	type Paragraph,
	type Rect,
	type Vec2
} from '../document';
import type { ClipboardPayload } from './clipboardPayload';
import {
	centringShift,
	intersection,
	pushRightOfSiblings,
	rectsIntersect,
	roundedFrom
} from './placement';
import type { ZoomRule } from './pasteView';
import { isPositioned, sortByDocumentOrder, topLevelIds, unionBounds } from './selectionOps';

/** `here` puts the top left on the cursor (Figma); `drop` centres the content on the drop point. */
export type PasteMode = 'default' | 'in-place' | 'over-selection' | 'replace' | 'here' | 'drop';

export interface PasteSettings {
	mode: PasteMode;
	documentId: string;
	currentPageId: NodeId;
	selection: readonly NodeId[];
	/** The visible world rectangle; `null` when there is no canvas (tests, headless). */
	viewport: Rect | null;
	/** World point of the cursor for paste here. */
	cursor: Vec2 | null;
}

export interface PastePlan {
	changes: Change[];
	newRootIds: NodeId[];
	/** Absolute bounds of the pasted roots, for the view to follow; `null` when not tracked. */
	placedBounds: Rect | null;
	zoomRule: ZoomRule;
}

interface Target {
	parentId: NodeId;
	/** Insert right above this child of `parentId`; `null` puts the nodes on top. */
	afterId: NodeId | null;
	/** Nodes the paste replaces. */
	replaced: NodeId[];
}

const EMPTY_PLAN: PastePlan = {
	changes: [],
	newRootIds: [],
	placedBounds: null,
	zoomRule: 'covers-safe-area'
};
const PASTE_TARGET_TYPES = ['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET'];
/** Fraction of the viewport a pasted image may fill. */
const IMAGE_VIEWPORT_FRACTION = 0.9;

// ---------- target ----------

function insideInstance(reader: DocumentReader, id: NodeId): boolean {
	return reader.ancestors(id).some((ancestor) => ancestor.type === 'INSTANCE');
}

/** Selecting this node and pasting puts the content inside it. */
function isPasteTarget(reader: DocumentReader, node: Node): boolean {
	if (!PASTE_TARGET_TYPES.includes(node.type)) return false;
	return !insideInstance(reader, node.id);
}

/** Nodes that can hold pasted content as a parent: containers and pages, never instances. */
function canHold(reader: DocumentReader, node: Node): boolean {
	if (node.type === 'PAGE') return true;
	if (node.type === 'INSTANCE') return false;
	if (!canHaveChildren(node.type)) return false;
	return !insideInstance(reader, node.id);
}

function pageTarget(settings: PasteSettings): Target {
	return { parentId: settings.currentPageId, afterId: null, replaced: [] };
}

function climbToHolder(reader: DocumentReader, anchorId: NodeId): Target {
	let child = reader.requireNode(anchorId);
	while (child.parentId !== null) {
		const parent = reader.requireNode(child.parentId);
		if (canHold(reader, parent)) return { parentId: parent.id, afterId: child.id, replaced: [] };
		child = parent;
	}
	throw new Error(`node ${anchorId} has no parent that can hold content`);
}

function selectedNodes(reader: DocumentReader, settings: PasteSettings): NodeId[] {
	const live = settings.selection.filter((id) => reader.hasNode(id));
	return sortByDocumentOrder(reader, topLevelIds(reader, live)).filter((id) =>
		isPositioned(reader.requireNode(id))
	);
}

function replaceTarget(reader: DocumentReader, selected: NodeId[]): Target {
	const first = reader.requireNode(selected[0]);
	const parentId = first.parentId;
	if (parentId === null) throw new Error(`node ${first.id} has no parent`);
	const siblings = selected.filter((id) => reader.requireNode(id).parentId === parentId);
	const replaced = selected.filter((id) => !Reflect.get(reader.requireNode(id), 'locked'));
	return { parentId, afterId: siblings[siblings.length - 1], replaced };
}

function isInView(reader: DocumentReader, id: NodeId, settings: PasteSettings): boolean {
	if (settings.viewport === null) return true;
	return rectsIntersect(reader.cache.absoluteBounds(id), settings.viewport);
}

/** With nothing selected, a copy from inside a frame goes back into that frame while it is on screen. */
function originalParentTarget(
	reader: DocumentReader,
	payload: ClipboardPayload,
	settings: PasteSettings
): Target | null {
	if (settings.mode !== 'default' && settings.mode !== 'here') return null;
	if (payload.documentId !== settings.documentId || payload.pageId !== settings.currentPageId) {
		return null;
	}
	const root = payload.nodes.find((candidate) => candidate.id === payload.roots[0].id);
	if (root === undefined || root.parentId === null || root.parentId === payload.pageId) return null;
	if (!reader.hasNode(root.parentId)) return null;
	const parent = reader.requireNode(root.parentId);
	if (!canHold(reader, parent) || !isInView(reader, parent.id, settings)) return null;
	return { parentId: parent.id, afterId: null, replaced: [] };
}

function isCopiedRoot(payload: ClipboardPayload, id: NodeId): boolean {
	return payload.roots.some((root) => root.id === id);
}

function resolveTarget(
	reader: DocumentReader,
	settings: PasteSettings,
	nextTo: NextTo | null,
	payload: ClipboardPayload | null
): Target {
	const selected = selectedNodes(reader, settings);
	if (selected.length === 0) {
		if (payload === null) return pageTarget(settings);
		const original = originalParentTarget(reader, payload, settings);
		if (original === null) return pageTarget(settings);
		return original;
	}
	if (settings.mode === 'replace') return replaceTarget(reader, selected);
	const anchorId = selected[selected.length - 1];
	if (nextTo !== null) return climbToHolder(reader, anchorId);
	// Pasting what is selected puts the copy beside it, not inside it.
	if (payload !== null && selected.every((id) => isCopiedRoot(payload, id))) {
		return climbToHolder(reader, anchorId);
	}
	const anchor = reader.requireNode(anchorId);
	if (!isPasteTarget(reader, anchor)) return climbToHolder(reader, anchorId);
	// A frame that is out of view is not a destination: the content goes to the page instead.
	if (settings.mode !== 'over-selection' && !isInView(reader, anchorId, settings)) {
		return pageTarget(settings);
	}
	return { parentId: anchorId, afterId: null, replaced: [] };
}

// ---------- placement ----------

interface NextTo {
	/** Top left, in page coordinates, where the push to the right starts. */
	start: Vec2;
}

function centred(area: Rect, size: { width: number; height: number }): Vec2 {
	return {
		x: area.x + (area.width - size.width) / 2,
		y: area.y + (area.height - size.height) / 2
	};
}

function parentAbsoluteBounds(reader: DocumentReader, parentId: NodeId): Rect | null {
	if (reader.requireNode(parentId).type === 'PAGE') return null;
	return reader.cache.absoluteBounds(parentId);
}

function isSingleTopLevelFrame(payload: ClipboardPayload): boolean {
	if (payload.roots.length !== 1) return false;
	const root = payload.nodes.find((candidate) => candidate.id === payload.roots[0].id);
	if (root === undefined) return false;
	return root.type === 'FRAME' && root.parentId === payload.pageId;
}

/** The original is where the user can see it: same file, same page, touching the view. */
function isOriginalInView(payload: ClipboardPayload, settings: PasteSettings): boolean {
	if (payload.documentId !== settings.documentId) return false;
	if (payload.pageId !== settings.currentPageId) return false;
	if (settings.viewport === null) return true;
	return rectsIntersect(payload.bounds, settings.viewport);
}

/** Next to the original needs its box on screen, even when it comes from another page or file. */
function originalTouchesView(payload: ClipboardPayload, settings: PasteSettings): boolean {
	if (settings.viewport === null) return isOriginalInView(payload, settings);
	return rectsIntersect(payload.bounds, settings.viewport);
}

const SAME_SIZE_TOLERANCE = 0.01;

function sameSize(bounds: Rect, other: Rect): boolean {
	const widthGap = bounds.width - other.width;
	const heightGap = bounds.height - other.height;
	return Math.abs(widthGap) <= SAME_SIZE_TOLERANCE && Math.abs(heightGap) <= SAME_SIZE_TOLERANCE;
}

/**
 * Ctrl+V of one top-level frame goes next to the original: with nothing selected, with that frame
 * selected, or with a top-level frame of the same size selected (the push then starts there).
 */
function nextToOf(
	reader: DocumentReader,
	payload: ClipboardPayload,
	settings: PasteSettings
): NextTo | null {
	if (settings.mode !== 'default') return null;
	if (!isSingleTopLevelFrame(payload)) return null;
	const originalOnScreen = originalTouchesView(payload, settings);
	const selected = selectedNodes(reader, settings);
	if (selected.length === 0) {
		if (!originalOnScreen) return null;
		return { start: { x: payload.bounds.x, y: payload.bounds.y } };
	}
	if (selected.length !== 1) return null;
	const frame = reader.requireNode(selected[0]);
	if (frame.type !== 'FRAME' || frame.parentId !== settings.currentPageId) return null;
	const bounds = reader.cache.absoluteBounds(frame.id);
	if (frame.id !== payload.roots[0].id && !sameSize(bounds, payload.bounds)) return null;
	// The original may have scrolled away after earlier pastes; the selected frame is what counts.
	if (!originalOnScreen && !isInView(reader, frame.id, settings)) return null;
	return { start: { x: bounds.x, y: bounds.y } };
}

function destinationNextTo(
	reader: DocumentReader,
	payload: ClipboardPayload,
	nextTo: NextTo,
	settings: PasteSettings
): Vec2 {
	const start = { ...nextTo.start, width: payload.bounds.width, height: payload.bounds.height };
	const free = pushRightOfSiblings(reader, settings.currentPageId, start);
	return { x: free.x, y: free.y };
}

function wasCopiedFromPage(payload: ClipboardPayload): boolean {
	const root = payload.nodes.find((candidate) => candidate.id === payload.roots[0].id);
	return root !== undefined && root.parentId === payload.pageId;
}

function relativePositionIn(payload: ClipboardPayload, parent: Rect): Vec2 {
	return {
		x: parent.x + payload.bounds.x - payload.parentOrigin.x,
		y: parent.y + payload.bounds.y - payload.parentOrigin.y
	};
}

/** Page coordinates stay as they are; coordinates inside a frame carry over to the new frame. */
function keptPositionIn(payload: ClipboardPayload, parent: Rect): Vec2 {
	if (wasCopiedFromPage(payload)) return { x: payload.bounds.x, y: payload.bounds.y };
	return relativePositionIn(payload, parent);
}

/** The position inside a frame: kept when it touches the frame, else centred per axis (11879). */
function destinationInFrame(
	payload: ClipboardPayload,
	parent: Rect,
	settings: PasteSettings
): Vec2 {
	if (settings.mode === 'over-selection') return relativePositionIn(payload, parent);
	const kept = keptPositionIn(payload, parent);
	const size = { width: payload.bounds.width, height: payload.bounds.height };
	const keptRect = { ...kept, ...size };
	if (rectsIntersect(parent, keptRect)) return kept;
	const visibleArea = visiblePart(parent, settings);
	return roundedFrom(payload.bounds, axisCentred(visibleArea, keptRect));
}

function visiblePart(parent: Rect, settings: PasteSettings): Rect {
	if (settings.viewport === null) return parent;
	const visible = intersection(parent, settings.viewport);
	if (visible === null) return parent;
	return visible;
}

/** Keeps an axis that still touches `area`, centres the others; both when the content is bigger. */
function axisCentred(area: Rect, content: Rect): Vec2 {
	const both = centred(area, content);
	if (content.width > area.width || content.height > area.height) return both;
	const horizontally = { ...content, x: both.x };
	if (rectsIntersect(area, horizontally)) return { x: both.x, y: content.y };
	const vertically = { ...content, y: both.y };
	if (rectsIntersect(area, vertically)) return { x: content.x, y: both.y };
	return both;
}

function destinationOnPage(payload: ClipboardPayload, settings: PasteSettings): Vec2 {
	const origin = { x: payload.bounds.x, y: payload.bounds.y };
	if (settings.mode === 'over-selection') return origin;
	if (settings.viewport === null) return origin;
	if (isOriginalInView(payload, settings)) return origin;
	const shift = centringShift(settings.viewport, payload.bounds);
	return { x: origin.x + shift.x, y: origin.y + shift.y };
}

function centredOnPoint(point: Vec2, size: { width: number; height: number }): Vec2 {
	return { x: point.x - size.width / 2, y: point.y - size.height / 2 };
}

function destinationFor(
	reader: DocumentReader,
	payload: ClipboardPayload,
	settings: PasteSettings,
	target: Target,
	nextTo: NextTo | null
): Vec2 {
	if (settings.mode === 'in-place') return { x: payload.bounds.x, y: payload.bounds.y };
	if (settings.mode === 'here' && settings.cursor !== null) {
		return roundedFrom(payload.bounds, settings.cursor);
	}
	if (settings.mode === 'drop' && settings.cursor !== null) {
		return centredOnPoint(settings.cursor, payload.bounds);
	}
	if (settings.mode === 'replace' && target.replaced.length > 0) {
		const area = unionBounds(target.replaced.map((id) => reader.cache.absoluteBounds(id)));
		return centred(area, payload.bounds);
	}
	if (isSingleTopLevelFrame(payload) && isEmptyPage(reader, target)) return { x: 0, y: 0 };
	if (nextTo !== null) return destinationNextTo(reader, payload, nextTo, settings);
	const parent = parentAbsoluteBounds(reader, target.parentId);
	if (parent !== null) return destinationInFrame(payload, parent, settings);
	return destinationOnPage(payload, settings);
}

// ---------- building the nodes ----------

function parentTransform(reader: DocumentReader, parentId: NodeId): Matrix2x3 {
	if (reader.requireNode(parentId).type === 'PAGE') {
		return [
			[1, 0, 0],
			[0, 1, 0]
		];
	}
	return reader.cache.absoluteTransform(parentId);
}

function localTransform(
	reader: DocumentReader,
	parentId: NodeId,
	absolute: Matrix2x3,
	shift: Vec2
): Matrix2x3 {
	const [[a, c, e], [b, d, f]] = absolute;
	const moved: Matrix2x3 = [
		[a, c, e + shift.x],
		[b, d, f + shift.y]
	];
	const inverse = invertMatrix(parentTransform(reader, parentId));
	if (inverse === null) return moved;
	return composeMatrices(inverse, moved);
}

function insertionIndexes(reader: DocumentReader, target: Target, count: number): string[] {
	const siblings = reader.childNodes(target.parentId);
	if (target.afterId === null) {
		return keysBetween(siblings.at(-1)?.index ?? null, null, count);
	}
	const position = siblings.findIndex((sibling) => sibling.id === target.afterId);
	const lower = siblings[position].index;
	const upper = siblings[position + 1]?.index ?? null;
	return keysBetween(lower, upper, count);
}

/** Instances whose main component is neither pasted along nor in this document. */
function detachedInstanceIds(reader: DocumentReader, payload: ClipboardPayload): Set<NodeId> {
	const pasted = new Set(payload.nodes.map((node) => node.id));
	const detached = new Set<NodeId>();
	for (const node of payload.nodes) {
		if (node.type !== 'INSTANCE') continue;
		if (pasted.has(node.mainComponentId)) continue;
		if (reader.hasNode(node.mainComponentId)) continue;
		detached.add(node.id);
	}
	return detached;
}

function stripComponentLinks(node: Node): void {
	delete node.componentRef;
	delete node.touched;
}

/** An instance that lost its main component becomes a plain frame, copy of what it showed. */
function detachInstance(node: Node): Node {
	stripComponentLinks(node);
	if (node.type !== 'INSTANCE') return node;
	const { mainComponentId: _main, componentProperties: _properties, ...rest } = node;
	return { ...rest, type: 'FRAME' };
}

function clearDanglingDestinations(node: Node, exists: (id: NodeId) => boolean): void {
	if (node.type === 'PAGE' || node.type === 'SLICE' || node.type === 'SECTION') return;
	for (const reaction of node.reactions) {
		for (const action of reaction.actions) {
			if (action.type !== 'NODE' || action.destinationId === null) continue;
			if (!exists(action.destinationId)) action.destinationId = null;
		}
	}
}

interface Instantiated {
	nodes: Node[];
	rootIds: NodeId[];
}

function instantiate(
	reader: DocumentReader,
	payload: ClipboardPayload,
	target: Target,
	shift: Vec2,
	generate: IdGenerator
): Instantiated {
	const idMap = new Map<NodeId, NodeId>(payload.nodes.map((node) => [node.id, generate()]));
	const detached = detachedInstanceIds(reader, payload);
	const rootTransforms = new Map(payload.roots.map((root) => [root.id, root.absoluteTransform]));
	const indexes = insertionIndexes(reader, target, payload.roots.length);
	const rootIds: NodeId[] = [];
	const nodes: Node[] = [];
	const underDetached = new Set<NodeId>();
	for (const original of payload.nodes) {
		let copy = structuredClone(original);
		remapReferences(copy, idMap);
		copy.id = lookup(idMap, original.id);
		const rootPosition = payload.roots.findIndex((root) => root.id === original.id);
		if (rootPosition >= 0) {
			copy.parentId = target.parentId;
			copy.index = indexes[rootPosition];
			rootIds.push(copy.id);
			const absolute = rootTransforms.get(original.id);
			if (absolute !== undefined && isPositioned(copy)) {
				copy.transform = localTransform(reader, target.parentId, absolute, shift);
			}
		} else if (original.parentId !== null) {
			copy.parentId = lookup(idMap, original.parentId);
		}
		if (copy.type === 'COMPONENT' || copy.type === 'COMPONENT_SET') copy.key = copy.id;
		const isDetachedInstance = detached.has(original.id);
		const isInsideDetached = original.parentId !== null && underDetached.has(original.parentId);
		if (isDetachedInstance || isInsideDetached) underDetached.add(original.id);
		if (isInsideDetached) stripComponentLinks(copy);
		if (isDetachedInstance) copy = detachInstance(copy);
		nodes.push(copy);
	}
	const pastedIds = new Set(nodes.map((node) => node.id));
	for (const node of nodes) {
		clearDanglingDestinations(node, (id) => pastedIds.has(id) || reader.hasNode(id));
	}
	return { nodes, rootIds };
}

function planMissingEntities(reader: DocumentReader, payload: ClipboardPayload): Change[] {
	const changes: Change[] = [];
	const add = <K extends keyof EntityMap>(kind: K, entities: EntityMap[K][]): void => {
		for (const entity of entities) {
			if (reader.getEntity(kind, entity.id) !== undefined) continue;
			changes.push(...planEntityAdd(kind, entity));
		}
	};
	add('collection', payload.entities.collections);
	add('variable', payload.entities.variables);
	add('style', payload.entities.styles);
	add('asset', payload.entities.assets);
	return changes;
}

function planRemovals(reader: DocumentReader, target: Target): Change[] {
	const changes: Change[] = [];
	for (const id of target.replaced) changes.push(...planRemove(reader, id));
	return changes;
}

function isEmptyPage(reader: DocumentReader, target: Target): boolean {
	if (target.replaced.length > 0) return false;
	if (reader.requireNode(target.parentId).type !== 'PAGE') return false;
	return reader.childNodes(target.parentId).length === 0;
}

function zoomRuleFor(reader: DocumentReader, settings: PasteSettings, target: Target): ZoomRule {
	if (settings.mode === 'here') return 'larger-than-safe-area';
	if (isEmptyPage(reader, target)) return 'always';
	return 'covers-safe-area';
}

/** Paste the copied nodes according to `settings`; fresh ids, instances stay linked. */
export function planPaste(
	reader: DocumentReader,
	payload: ClipboardPayload,
	settings: PasteSettings,
	generate: IdGenerator = generateNodeId
): PastePlan {
	const nextTo = nextToOf(reader, payload, settings);
	const target = resolveTarget(reader, settings, nextTo, payload);
	if (settings.mode === 'replace' && target.replaced.length === 0) return EMPTY_PLAN;
	const destination = destinationFor(reader, payload, settings, target, nextTo);
	const shift = { x: destination.x - payload.bounds.x, y: destination.y - payload.bounds.y };
	const pasted = instantiate(reader, payload, target, shift, generate);
	const changes = [
		...planMissingEntities(reader, payload),
		...planInsertAll(pasted.nodes),
		...planRemovals(reader, target)
	];
	return {
		changes,
		newRootIds: pasted.rootIds,
		placedBounds: {
			...payload.bounds,
			x: payload.bounds.x + shift.x,
			y: payload.bounds.y + shift.y
		},
		zoomRule: zoomRuleFor(reader, settings, target)
	};
}

// ---------- text and images ----------

const CHARACTER_WIDTH = 0.55;
const LINE_HEIGHT = 1.25;

function paragraphOf(line: string): Paragraph {
	const runs: Paragraph['runs'] = [];
	if (line !== '') runs.push({ text: line, style: {} });
	return {
		runs,
		align: 'LEFT',
		indent: 0,
		spacingAfter: 0,
		list: 'NONE',
		listLevel: 0
	};
}

/** A text node holding `text`, sized by an estimate until text layout measures it. */
export function buildTextNode(text: string): Node {
	const lines = text.split(/\r\n|\r|\n/);
	const node = createNode('TEXT', { name: lines[0].slice(0, 40) });
	const fontSize = node.defaultStyle.fontSize;
	const longest = Math.max(...lines.map((line) => line.length), 1);
	return {
		...node,
		paragraphs: lines.map(paragraphOf),
		textAutoResize: 'WIDTH_AND_HEIGHT',
		width: Math.ceil(longest * fontSize * CHARACTER_WIDTH),
		height: Math.ceil(lines.length * fontSize * LINE_HEIGHT)
	};
}

export interface PastedImage {
	hash: string;
	width: number;
	height: number;
}

export function fittedSize(
	image: PastedImage,
	viewport: Rect | null
): { width: number; height: number } {
	if (viewport === null) return { width: image.width, height: image.height };
	const scale = Math.min(
		1,
		(viewport.width * IMAGE_VIEWPORT_FRACTION) / image.width,
		(viewport.height * IMAGE_VIEWPORT_FRACTION) / image.height
	);
	return { width: Math.round(image.width * scale), height: Math.round(image.height * scale) };
}

/** A rectangle at natural size (shrunk to the viewport) with an image fill. */
export function buildImageNode(image: PastedImage, viewport: Rect | null): Node {
	const size = fittedSize(image, viewport);
	const fill: ImagePaint = {
		type: 'IMAGE',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		imageHash: image.hash,
		scaleMode: 'FILL'
	};
	return createNode('RECTANGLE', {
		name: 'Image',
		width: size.width,
		height: size.height,
		fills: [fill]
	});
}

function newNodeDestination(
	reader: DocumentReader,
	node: Node,
	settings: PasteSettings,
	target: Target
): Vec2 {
	if (!isPositioned(node)) return { x: 0, y: 0 };
	const size = { width: node.width, height: node.height };
	if (settings.mode === 'here' && settings.cursor !== null) {
		return centredOnPoint(settings.cursor, size);
	}
	const parent = parentAbsoluteBounds(reader, target.parentId);
	if (parent !== null) return centred(parent, size);
	if (settings.viewport !== null) return centred(settings.viewport, size);
	return { x: 0, y: 0 };
}

/**
 * Insert a new node (pasted text or image) by the same target rules as `planPaste`, centred in
 * the frame it lands in, on the cursor for paste here, else on the viewport.
 */
export function planPasteNode(
	reader: DocumentReader,
	node: Node,
	settings: PasteSettings,
	extraChanges: Change[] = [],
	generate: IdGenerator = generateNodeId
): PastePlan {
	if (!isPositioned(node)) return EMPTY_PLAN;
	const target = resolveTarget(
		reader,
		{ ...settings, mode: settings.mode === 'here' ? 'here' : 'default' },
		null,
		null
	);
	const destination = newNodeDestination(reader, node, settings, target);
	const placed: Node = { ...node, id: generate(), parentId: target.parentId };
	placed.index = insertionIndexes(reader, target, 1)[0];
	if (isPositioned(placed)) {
		const identity: Matrix2x3 = [
			[1, 0, destination.x],
			[0, 1, destination.y]
		];
		placed.transform = localTransform(reader, target.parentId, identity, { x: 0, y: 0 });
	}
	return {
		changes: [...extraChanges, ...planInsertAll([placed])],
		newRootIds: [placed.id],
		placedBounds: null,
		zoomRule: 'covers-safe-area'
	};
}
