// Comments are local notes pinned to a place on a page, stored as document data: one entry per
// comment in the page node's `pluginData` under the `comments` namespace (data-model.md section 1:
// pluginData is namespaced by plugin id and every node has it). That makes them part of the file,
// of undo and of the audit trail without a new table; the value is the comment as JSON text
// because pluginData values are strings.
//
// A comment pinned to a node stores where it sits relative to that node, so the pin follows the
// node when it moves or resizes; if the node is gone the pin stays where it last was (`x`, `y`).

import type { Node, NodeId, Rect } from '../document/types';

export const COMMENTS_NAMESPACE = 'comments';

export interface Comment {
	id: string;
	pageId: NodeId;
	/** Page position when the comment is free, or the fallback when its node is gone. */
	x: number;
	y: number;
	/** The node the comment was dropped on, if any. */
	anchorId: NodeId | null;
	/** Offset from the anchor's top-left corner, in page units. */
	offsetX: number;
	offsetY: number;
	text: string;
	resolved: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface Point {
	x: number;
	y: number;
}

export type PluginData = Node['pluginData'];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	return undefined;
}

function parseComment(pageId: NodeId, id: string, text: string): Comment | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(raw)) return undefined;
	const x = finiteNumber(raw.x);
	const y = finiteNumber(raw.y);
	if (x === undefined || y === undefined) return undefined;
	if (typeof raw.text !== 'string') return undefined;
	const createdAt = finiteNumber(raw.createdAt);
	const updatedAt = finiteNumber(raw.updatedAt);
	const offsetX = finiteNumber(raw.offsetX);
	const offsetY = finiteNumber(raw.offsetY);
	let anchorId: NodeId | null = null;
	if (typeof raw.anchorId === 'string') anchorId = raw.anchorId;
	return {
		id,
		pageId,
		x,
		y,
		anchorId,
		offsetX: offsetX === undefined ? 0 : offsetX,
		offsetY: offsetY === undefined ? 0 : offsetY,
		text: raw.text,
		resolved: raw.resolved === true,
		createdAt: createdAt === undefined ? 0 : createdAt,
		updatedAt: updatedAt === undefined ? 0 : updatedAt
	};
}

/** The comments stored on a page, oldest first. Entries that do not parse are skipped. */
export function readComments(pageId: NodeId, pluginData: PluginData): Comment[] {
	const entries = pluginData[COMMENTS_NAMESPACE];
	if (entries === undefined) return [];
	const comments: Comment[] = [];
	for (const [id, text] of Object.entries(entries)) {
		const comment = parseComment(pageId, id, text);
		if (comment !== undefined) comments.push(comment);
	}
	return comments.sort((left, right) => left.createdAt - right.createdAt);
}

function serialise(comment: Comment): string {
	return JSON.stringify({
		x: comment.x,
		y: comment.y,
		anchorId: comment.anchorId,
		offsetX: comment.offsetX,
		offsetY: comment.offsetY,
		text: comment.text,
		resolved: comment.resolved,
		createdAt: comment.createdAt,
		updatedAt: comment.updatedAt
	});
}

/** The `pluginData` of a page with `comment` added or replaced. */
export function withComment(pluginData: PluginData, comment: Comment): PluginData {
	const entries = { ...pluginData[COMMENTS_NAMESPACE], [comment.id]: serialise(comment) };
	return { ...pluginData, [COMMENTS_NAMESPACE]: entries };
}

/** The `pluginData` of a page without comment `id` (the namespace goes with its last comment). */
export function withoutComment(pluginData: PluginData, id: string): PluginData {
	const entries = { ...pluginData[COMMENTS_NAMESPACE] };
	delete entries[id];
	const rest = { ...pluginData };
	if (Object.keys(entries).length === 0) {
		delete rest[COMMENTS_NAMESPACE];
		return rest;
	}
	return { ...rest, [COMMENTS_NAMESPACE]: entries };
}

/** Where a pin sits now: relative to its node when that still exists, else where it was. */
export function pinPosition(
	comment: Comment,
	anchorBounds: (id: NodeId) => Rect | undefined
): Point {
	if (comment.anchorId === null) return { x: comment.x, y: comment.y };
	const bounds = anchorBounds(comment.anchorId);
	if (bounds === undefined) return { x: comment.x, y: comment.y };
	return { x: bounds.x + comment.offsetX, y: bounds.y + comment.offsetY };
}

/** A new comment at `point`, pinned to `anchor` (its top-left corner as `anchorOrigin`) if given. */
export function newComment(input: {
	id: string;
	pageId: NodeId;
	point: Point;
	anchorId: NodeId | null;
	anchorOrigin: Point | null;
	text: string;
	now: number;
}): Comment {
	let offsetX = 0;
	let offsetY = 0;
	if (input.anchorOrigin !== null) {
		offsetX = input.point.x - input.anchorOrigin.x;
		offsetY = input.point.y - input.anchorOrigin.y;
	}
	return {
		id: input.id,
		pageId: input.pageId,
		x: input.point.x,
		y: input.point.y,
		anchorId: input.anchorId,
		offsetX,
		offsetY,
		text: input.text,
		resolved: false,
		createdAt: input.now,
		updatedAt: input.now
	};
}

export type CommentFilter = 'all' | 'open' | 'resolved';

/** Search text (case-insensitive, in the note or the page name) and the open/resolved filter. */
export function matchesComment(
	comment: { text: string; resolved: boolean; pageName: string },
	query: string,
	filter: CommentFilter
): boolean {
	if (filter === 'open' && comment.resolved) return false;
	if (filter === 'resolved' && !comment.resolved) return false;
	const needle = query.trim().toLowerCase();
	if (needle === '') return true;
	return (
		comment.text.toLowerCase().includes(needle) || comment.pageName.toLowerCase().includes(needle)
	);
}

/** The pin whose circle contains `screen`, nearest to its centre first. */
export function pinHit<Pin extends { screen: Point }>(
	pins: readonly Pin[],
	screen: Point,
	radius: number
): Pin | undefined {
	let best: Pin | undefined;
	let bestDistance = radius;
	for (const pin of pins) {
		const distance = Math.hypot(pin.screen.x - screen.x, pin.screen.y - screen.y);
		if (distance > bestDistance) continue;
		best = pin;
		bestDistance = distance;
	}
	return best;
}
