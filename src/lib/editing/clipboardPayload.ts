// The clipboard form of a copied selection: the subtrees with their original ids, where they were
// (absolute transforms, so any destination can be computed) and the library entities they use
// (variables, styles, assets) so a paste into another file keeps its bindings.
//
// The Electron clipboard in main takes text, html and png only, so the JSON travels in the html
// as `<span data-design-clone="base64">`, the way Figma does it. `CLIPBOARD_FORMAT` names the
// payload; it is also the clipboard key of in-page fallbacks.

import type {
	AssetRecord,
	DocumentReader,
	Matrix2x3,
	Node,
	NodeId,
	Rect,
	Style,
	Variable,
	VariableCollection,
	Vec2
} from '../document';
import { plainText } from '../document';
import { isPositioned, sortByDocumentOrder, topLevelIds, unionBounds } from './selectionOps';

export const CLIPBOARD_FORMAT = 'application/x-design-clone';
const PAYLOAD_VERSION = 1;
const ATTRIBUTE = 'data-design-clone';

export interface ClipboardRoot {
	id: NodeId;
	/** Absolute transform when copied. */
	absoluteTransform: Matrix2x3;
}

export interface ClipboardEntities {
	variables: Variable[];
	collections: VariableCollection[];
	styles: Style[];
	assets: AssetRecord[];
}

export interface ClipboardPayload {
	format: typeof CLIPBOARD_FORMAT;
	version: number;
	documentId: string;
	pageId: NodeId;
	/** Roots in z-order (bottom first), each followed by its descendants, parents first. */
	nodes: Node[];
	roots: ClipboardRoot[];
	/** Union of the roots' absolute bounds when copied. */
	bounds: Rect;
	/** Absolute top-left of the roots' parent when copied; the origin of the page for a page. */
	parentOrigin: Vec2;
	entities: ClipboardEntities;
}

function emptyEntities(): ClipboardEntities {
	return { variables: [], collections: [], styles: [], assets: [] };
}

/** Entities whose id occurs as a string anywhere in the copied nodes (bindings, styles, hashes). */
function referencedEntities(reader: DocumentReader, nodes: Node[]): ClipboardEntities {
	const text = JSON.stringify(nodes);
	const used = (id: string): boolean => text.includes(`"${id}"`);
	const entities = emptyEntities();
	entities.variables = reader.entities('variable').filter((variable) => used(variable.id));
	entities.styles = reader.entities('style').filter((style) => used(style.id));
	entities.assets = reader.entities('asset').filter((asset) => used(asset.id));
	const collectionIds = new Set(entities.variables.map((variable) => variable.collectionId));
	entities.collections = reader
		.entities('collection')
		.filter((entry) => collectionIds.has(entry.id));
	return entities;
}

function parentOriginOf(reader: DocumentReader, rootId: NodeId): Vec2 {
	const parentId = reader.requireNode(rootId).parentId;
	if (parentId === null) return { x: 0, y: 0 };
	if (reader.requireNode(parentId).type === 'PAGE') return { x: 0, y: 0 };
	const bounds = reader.cache.absoluteBounds(parentId);
	return { x: bounds.x, y: bounds.y };
}

/** Roots (top-level selected, pages excluded) in z-order, or none when nothing can be copied. */
export function copyableIds(reader: DocumentReader, ids: readonly NodeId[]): NodeId[] {
	const roots = sortByDocumentOrder(reader, topLevelIds(reader, ids));
	return roots.filter((id) => isPositioned(reader.requireNode(id)));
}

/** The payload for the selection; `null` when nothing in it can be copied. */
export function buildPayload(
	reader: DocumentReader,
	ids: readonly NodeId[]
): ClipboardPayload | null {
	const rootIds = copyableIds(reader, ids);
	if (rootIds.length === 0) return null;
	const nodes: Node[] = [];
	for (const rootId of rootIds) {
		nodes.push(structuredClone(reader.requireNode(rootId)));
		for (const descendant of reader.descendants(rootId)) nodes.push(structuredClone(descendant));
	}
	return {
		format: CLIPBOARD_FORMAT,
		version: PAYLOAD_VERSION,
		documentId: reader.document.id,
		pageId: reader.pageOf(rootIds[0]).id,
		nodes,
		roots: rootIds.map((id) => ({ id, absoluteTransform: reader.cache.absoluteTransform(id) })),
		bounds: unionBounds(rootIds.map((id) => reader.cache.absoluteBounds(id))),
		parentOrigin: parentOriginOf(reader, rootIds[0]),
		entities: referencedEntities(reader, nodes)
	};
}

/** What other applications get as plain text: the text of a single text node, else layer names. */
export function fallbackText(payload: ClipboardPayload): string {
	const roots = payload.roots.map((root) => payload.nodes.find((node) => node.id === root.id));
	const texts: string[] = [];
	for (const node of roots) {
		if (node === undefined) continue;
		if (node.type === 'TEXT') texts.push(plainText(node.paragraphs));
		else texts.push(node.name);
	}
	return texts.join('\n');
}

// ---------- html carrier ----------

const CHUNK = 0x8000;

function toBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (let start = 0; start < bytes.length; start += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
	}
	return btoa(binary);
}

function fromBase64(encoded: string): string {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let position = 0; position < binary.length; position += 1) {
		bytes[position] = binary.charCodeAt(position);
	}
	return new TextDecoder().decode(bytes);
}

export function encodePayload(payload: ClipboardPayload): string {
	return `<meta charset="utf-8"><span ${ATTRIBUTE}="${toBase64(JSON.stringify(payload))}"></span>`;
}

function isPayload(value: unknown): value is ClipboardPayload {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	if (record.format !== CLIPBOARD_FORMAT) return false;
	if (record.version !== PAYLOAD_VERSION) return false;
	return Array.isArray(record.nodes) && Array.isArray(record.roots) && record.roots.length > 0;
}

/** The payload inside clipboard html, or `null` for foreign or damaged html. */
export function decodePayload(html: string | null): ClipboardPayload | null {
	if (html === null) return null;
	const match = new RegExp(`${ATTRIBUTE}="([A-Za-z0-9+/=]+)"`).exec(html);
	if (match === null) return null;
	try {
		const parsed: unknown = JSON.parse(fromBase64(match[1]));
		if (isPayload(parsed)) return parsed;
		return null;
	} catch {
		return null;
	}
}
