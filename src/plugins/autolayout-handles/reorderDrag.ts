// Dragging children of an auto layout frame reorders them. The drag takes over from the free
// move (`move/begin`, lib/selecting/moveDrag.ts). As in Figma the order changes live: every
// pointer move applies the new slot inside one history group (one undo step), and the overlay
// outlines where the pointer holds the nodes.
//
//   over an auto layout frame   the nodes take that slot (reparenting into another auto layout
//                               frame is the same move); reflow puts them in place. Inside the
//                               frame they started in, the slot changes when the leading edge of
//                               the dragged nodes passes the centre of a neighbour
//   over any other container    the nodes leave auto layout and follow the pointer; the pointer
//                               must be LEAVE_DISTANCE outside the frame they sit in to do so
//   Space held                  the drop stays in the frame the drag started in

import type { Context } from '@neoworks/extension-system';
import {
	keysBetween,
	planSetProps,
	type Change,
	type DocumentReader,
	type Matrix2x3,
	type Node,
	type NodeId,
	type Rect
} from '../../lib/document';
import {
	isAutoLayoutChild,
	sortByDocumentOrder,
	topLevelIds
} from '../../lib/editing/selectionOps';
import { nestingSource } from '../../lib/editing/creationTool.svelte';
import { dropSlot, type DropSlot, type Point } from '../../lib/layout/dropIndex';
import { isStackContainer } from '../../lib/layout/build';
import { planDrag } from '../../lib/selecting/drag';
import type { MoveBeginRequest, MoveDrag } from '../../lib/selecting/moveDrag';
import { findContainer, type NestingSource } from '../../lib/tools/creation';
import type { Modifiers } from '../../lib/tools/protocol';
import type { HandlesFeedback } from './feedback.svelte';

/** Screen-independent distance (page px) the pointer must be outside a stack to pull a child out. */
const LEAVE_DISTANCE = 32;

interface DropPlan {
	targetId: NodeId;
	/** Set when the target is an auto layout frame. */
	slot: DropSlot | null;
}

export class ReorderDrag implements MoveDrag {
	private pinned = false;
	private readonly group: ReturnType<Context['history']['beginGroup']>;
	private readonly origins: { id: NodeId; origin: Matrix2x3 }[];
	private readonly startBounds: Rect[];
	private lastWorld: Point;
	private lastModifiers: Modifiers;

	private constructor(
		private readonly ctx: Context,
		private readonly feedback: HandlesFeedback,
		private readonly ids: NodeId[],
		private readonly parentId: NodeId,
		private readonly startWorld: Point,
		modifiers: Modifiers
	) {
		this.lastWorld = startWorld;
		this.lastModifiers = modifiers;
		const reader = ctx.document.reader;
		this.origins = ids.map((id) => ({ id, origin: reader.cache.absoluteTransform(id) }));
		this.startBounds = ids.map((id) => ctx.document.absoluteBounds(id));
		this.group = ctx.history.beginGroup({ label: 'Reorder' });
	}

	/** Take the drag when every dragged node is a flow child of one auto layout frame. */
	static begin(
		ctx: Context,
		feedback: HandlesFeedback,
		request: MoveBeginRequest
	): ReorderDrag | undefined {
		if (request.modifiers.altKey) return undefined;
		const reader = ctx.document.reader;
		const ids = topLevelIds(reader, request.ids);
		if (ids.length === 0) return undefined;
		const parentId = sharedStackParent(reader, ids);
		if (parentId === undefined) return undefined;
		const ordered = sortByDocumentOrder(reader, ids);
		return new ReorderDrag(ctx, feedback, ordered, parentId, request.startWorld, request.modifiers);
	}

	setPinned(pinned: boolean): void {
		this.pinned = pinned;
		this.update(this.lastWorld, this.lastModifiers);
	}

	refresh(modifiers: Modifiers): void {
		this.update(this.lastWorld, modifiers);
	}

	update(world: Point, modifiers: Modifiers): void {
		this.lastWorld = world;
		this.lastModifiers = modifiers;
		const plan = this.plan(world);
		const changes = this.changesFor(plan);
		if (changes.length > 0) this.ctx.document.apply(changes, { origin: 'user', label: 'Reorder' });
		this.feedback.reorder = {
			targetId: plan.targetId,
			line: null,
			ghosts: this.ghosts(world)
		};
	}

	commit(): void {
		this.feedback.reorder = null;
		this.ctx.history.endGroup(this.group);
	}

	cancel(): void {
		this.feedback.reorder = null;
		this.ctx.history.cancelGroup(this.group);
	}

	// ---------- where the drop lands ----------

	private plan(world: Point): DropPlan {
		const targetId = this.targetAt(world);
		const target = this.ctx.document.require(targetId);
		if (!isStackContainer(target)) return { targetId, slot: null };
		return { targetId, slot: this.slotIn(targetId, world) };
	}

	private targetAt(world: Point): NodeId {
		if (this.pinned) return this.parentId;
		const dragged = new Set(this.ids);
		const base = nestingSource(this.ctx);
		const source: NestingSource = {
			...base,
			children: (id) => base.children(id).filter((child) => !dragged.has(child))
		};
		const found = findContainer(source, this.ctx.document.currentPageId, world);
		return this.stickToCurrentStack(found, world);
	}

	/** A child only leaves its stack once the pointer is LEAVE_DISTANCE outside of it. */
	private stickToCurrentStack(found: NodeId, world: Point): NodeId {
		const reader = this.ctx.document.reader;
		const currentId = reader.requireNode(this.ids[0]).parentId;
		if (currentId === null || found === currentId) return found;
		if (!isStackContainer(reader.requireNode(currentId))) return found;
		if (reader.ancestors(found).some((ancestor) => ancestor.id === currentId)) return found;
		const bounds = this.ctx.document.absoluteBounds(currentId);
		const outsideX = Math.max(bounds.x - world.x, 0, world.x - (bounds.x + bounds.width));
		const outsideY = Math.max(bounds.y - world.y, 0, world.y - (bounds.y + bounds.height));
		if (Math.max(outsideX, outsideY) >= LEAVE_DISTANCE) return found;
		return currentId;
	}

	private slotIn(frameId: NodeId, world: Point): DropSlot | null {
		const reader = this.ctx.document.reader;
		const frame = reader.requireNode(frameId);
		if (!isStackContainer(frame)) return null;
		if (frame.layoutMode === 'GRID' || frame.layoutMode === 'NONE') return null;
		const dragged = new Set(this.ids);
		const rects: Rect[] = [];
		for (const child of reader.childNodes(frameId)) {
			if (dragged.has(child.id) || !isFlowChild(child)) continue;
			rects.push(this.ctx.document.absoluteBounds(child.id));
		}
		const bounds = this.ctx.document.absoluteBounds(frameId);
		const inner = {
			x: bounds.x + frame.paddingLeft,
			y: bounds.y + frame.paddingTop,
			width: Math.max(0, bounds.width - frame.paddingLeft - frame.paddingRight),
			height: Math.max(0, bounds.height - frame.paddingTop - frame.paddingBottom)
		};
		const sameFrame = reader.requireNode(this.ids[0]).parentId === frameId;
		if (sameFrame && frame.layoutWrap !== 'WRAP') {
			return this.edgeSlot(frame.layoutMode, rects);
		}
		return dropSlot({
			mode: frame.layoutMode,
			wrap: frame.layoutWrap === 'WRAP',
			rects,
			inner,
			point: world
		});
	}

	/**
	 * Live reordering inside the frame the nodes sit in: the slot is the number of neighbours whose
	 * centre lies before the leading edge of the dragged nodes (the edge towards which they have
	 * been pulled away from their laid-out position).
	 */
	private edgeSlot(mode: 'HORIZONTAL' | 'VERTICAL', rects: readonly Rect[]): DropSlot {
		const horizontal = mode === 'HORIZONTAL';
		const held = union(this.ghosts(this.lastWorld));
		const laidOut = union(this.ids.map((id) => this.ctx.document.absoluteBounds(id)));
		const start = horizontal ? held.x : held.y;
		const size = horizontal ? held.width : held.height;
		const placedStart = horizontal ? laidOut.x : laidOut.y;
		let edge = start + size / 2;
		if (start > placedStart) edge = start + size;
		if (start < placedStart) edge = start;
		let index = 0;
		for (const rect of rects) {
			const centre = horizontal ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
			if (centre < edge) index += 1;
		}
		const origin = { x: held.x, y: held.y };
		return { index, line: { from: origin, to: origin } };
	}

	private ghosts(world: Point): Rect[] {
		const dx = world.x - this.startWorld.x;
		const dy = world.y - this.startWorld.y;
		return this.startBounds.map((bounds) => ({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }));
	}

	// ---------- the drop ----------

	private changesFor(plan: DropPlan): Change[] {
		if (plan.slot === null) return this.leaveAutoLayout(plan.targetId);
		return this.insertAt(plan.targetId, plan.slot.index);
	}

	private insertAt(targetId: NodeId, index: number): Change[] {
		const reader = this.ctx.document.reader;
		const dragged = new Set(this.ids);
		const siblings = reader.childNodes(targetId).filter((child) => !dragged.has(child.id));
		const slot = Math.max(0, Math.min(index, siblings.length));
		if (this.keepsOrder(targetId, siblings, slot)) return [];
		const before = slot > 0 ? siblings[slot - 1].index : null;
		const after = slot < siblings.length ? siblings[slot].index : null;
		const keys = keysBetween(before, after, this.ids.length);
		return this.ids.map((id, position) => {
			const node = reader.requireNode(id);
			return {
				t: 'move',
				id,
				parent: targetId,
				index: keys[position],
				prevParent: node.parentId,
				prevIndex: node.index
			};
		});
	}

	/** Dropping the nodes into the slot they already hold changes nothing. */
	private keepsOrder(targetId: NodeId, siblings: readonly Node[], slot: number): boolean {
		const current = this.ctx.document.children(targetId);
		const next = [
			...siblings.slice(0, slot).map((node) => node.id),
			...this.ids,
			...siblings.slice(slot).map((node) => node.id)
		];
		return current.length === next.length && current.every((id, position) => id === next[position]);
	}

	private leaveAutoLayout(targetId: NodeId): Change[] {
		const reader = this.ctx.document.reader;
		const delta = {
			x: this.lastWorld.x - this.startWorld.x,
			y: this.lastWorld.y - this.startWorld.y
		};
		const changes = planDrag(reader, this.origins, delta, () => targetId);
		for (const id of this.ids) {
			changes.push(...planSetProps(reader, id, releasedSizing(reader.requireNode(id))));
		}
		return changes;
	}
}

function isFlowChild(node: Node): boolean {
	if (node.type === 'PAGE' || !node.visible) return false;
	if (!('layoutPositioning' in node)) return true;
	return node.layoutPositioning !== 'ABSOLUTE';
}

/** The parent the nodes share when it is an auto layout frame and each of them is in its flow. */
function sharedStackParent(reader: DocumentReader, ids: readonly NodeId[]): NodeId | undefined {
	let parentId: NodeId | undefined;
	for (const id of ids) {
		const node = reader.requireNode(id);
		if (node.type === 'PAGE' || node.locked || node.parentId === null) return undefined;
		if (!isAutoLayoutChild(reader, node)) return undefined;
		if (parentId !== undefined && parentId !== node.parentId) return undefined;
		parentId = node.parentId;
	}
	return parentId;
}

/** A fill size has nothing to fill once the node left auto layout. */
function releasedSizing(node: Node): Record<string, unknown> {
	if (!('layoutSizingHorizontal' in node)) return {};
	return {
		layoutSizingHorizontal:
			node.layoutSizingHorizontal === 'FILL' ? 'FIXED' : node.layoutSizingHorizontal,
		layoutSizingVertical: node.layoutSizingVertical === 'FILL' ? 'FIXED' : node.layoutSizingVertical
	};
}

function union(rects: readonly Rect[]): Rect {
	const left = Math.min(...rects.map((rect) => rect.x));
	const top = Math.min(...rects.map((rect) => rect.y));
	const right = Math.max(...rects.map((rect) => rect.x + rect.width));
	const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
}
