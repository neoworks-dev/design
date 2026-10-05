// Planning for paste (docs/research/interactions.md section 12). Pure: payload and document in,
// change list out.
//
// Where the pasted nodes go (parent and z-position):
//   - nothing selected: the current page, on top;
//   - a frame, section or component selected: inside it, on top;
//   - anything else selected: its parent (climbing past instances), right above the selection.
// Replace takes the selection's place and removes it.
//
// Where they land (absolute position of the pasted bounds):
//   - paste in place: exactly where they were copied from;
//   - paste here: centred on the cursor;
//   - replace: centred on the replaced nodes;
//   - into a frame (or group): same coordinates relative to the frame, centred when that does not
//     fit; paste over selection keeps the relative coordinates even when they do not fit;
//   - onto a page: the original coordinates when it is a different page or file, or when the
//     original is still in view, else the centre of the viewport.

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
import { isPositioned, sortByDocumentOrder, topLevelIds, unionBounds } from './selectionOps';

export type PasteMode = 'default' | 'in-place' | 'over-selection' | 'replace' | 'here';

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
}

interface Target {
	parentId: NodeId;
	/** Insert right above this child of `parentId`; `null` puts the nodes on top. */
	afterId: NodeId | null;
	/** Nodes the paste replaces. */
	replaced: NodeId[];
}

const EMPTY_PLAN: PastePlan = { changes: [], newRootIds: [] };
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

function resolveTarget(reader: DocumentReader, settings: PasteSettings): Target {
	const selected = selectedNodes(reader, settings);
	if (selected.length === 0) return pageTarget(settings);
	if (settings.mode === 'replace') return replaceTarget(reader, selected);
	const anchorId = selected[selected.length - 1];
	if (isPasteTarget(reader, reader.requireNode(anchorId))) {
		return { parentId: anchorId, afterId: null, replaced: [] };
	}
	return climbToHolder(reader, anchorId);
}

// ---------- placement ----------

function containsRect(outer: Rect, inner: Rect): boolean {
	if (inner.x < outer.x || inner.y < outer.y) return false;
	if (inner.x + inner.width > outer.x + outer.width) return false;
	return inner.y + inner.height <= outer.y + outer.height;
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

function fitsInside(offset: Vec2, size: Rect, parent: Rect): boolean {
	if (offset.x < 0 || offset.y < 0) return false;
	if (offset.x + size.width > parent.width) return false;
	return offset.y + size.height <= parent.height;
}

function destinationInFrame(payload: ClipboardPayload, parent: Rect, mode: PasteMode): Vec2 {
	const offset = {
		x: payload.bounds.x - payload.parentOrigin.x,
		y: payload.bounds.y - payload.parentOrigin.y
	};
	if (mode === 'over-selection' || fitsInside(offset, payload.bounds, parent)) {
		return { x: parent.x + offset.x, y: parent.y + offset.y };
	}
	return centred(parent, payload.bounds);
}

function destinationOnPage(payload: ClipboardPayload, settings: PasteSettings): Vec2 {
	const origin = { x: payload.bounds.x, y: payload.bounds.y };
	if (settings.mode === 'over-selection') return origin;
	const elsewhere =
		payload.documentId !== settings.documentId || payload.pageId !== settings.currentPageId;
	if (elsewhere) return origin;
	if (settings.viewport === null) return origin;
	if (containsRect(settings.viewport, payload.bounds)) return origin;
	return centred(settings.viewport, payload.bounds);
}

function centredOnPoint(point: Vec2, size: { width: number; height: number }): Vec2 {
	return { x: point.x - size.width / 2, y: point.y - size.height / 2 };
}

function destinationFor(
	reader: DocumentReader,
	payload: ClipboardPayload,
	settings: PasteSettings,
	target: Target
): Vec2 {
	if (settings.mode === 'in-place') return { x: payload.bounds.x, y: payload.bounds.y };
	if (settings.mode === 'here' && settings.cursor !== null) {
		return centredOnPoint(settings.cursor, payload.bounds);
	}
	if (settings.mode === 'replace' && target.replaced.length > 0) {
		const area = unionBounds(target.replaced.map((id) => reader.cache.absoluteBounds(id)));
		return centred(area, payload.bounds);
	}
	const parent = parentAbsoluteBounds(reader, target.parentId);
	if (parent !== null) return destinationInFrame(payload, parent, settings.mode);
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

/** Paste the copied nodes according to `settings`; fresh ids, instances stay linked. */
export function planPaste(
	reader: DocumentReader,
	payload: ClipboardPayload,
	settings: PasteSettings,
	generate: IdGenerator = generateNodeId
): PastePlan {
	const target = resolveTarget(reader, settings);
	if (settings.mode === 'replace' && target.replaced.length === 0) return EMPTY_PLAN;
	const destination = destinationFor(reader, payload, settings, target);
	const shift = { x: destination.x - payload.bounds.x, y: destination.y - payload.bounds.y };
	const pasted = instantiate(reader, payload, target, shift, generate);
	const changes = [
		...planMissingEntities(reader, payload),
		...planInsertAll(pasted.nodes),
		...planRemovals(reader, target)
	];
	return { changes, newRootIds: pasted.rootIds };
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
	const target = resolveTarget(reader, {
		...settings,
		mode: settings.mode === 'here' ? 'here' : 'default'
	});
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
		newRootIds: [placed.id]
	};
}
