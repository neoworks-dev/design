// Dragging children of an auto layout frame reorders them. The drag takes over from the free
// move (`move/begin`, lib/selecting/moveDrag.ts): the document is left alone while the pointer
// moves, the overlay shows the blue insertion line and outlines where the pointer holds the
// nodes, and the drop is ONE change set (one undo step):
//
//   over an auto layout frame   the nodes take that slot (reparenting into another auto layout
//                               frame is the same move); reflow puts them in place
//   over any other container    the nodes leave auto layout where they were dropped, keeping
//                               their page position
//   Space held                  the drop stays in the frame the drag started in

import type { Context } from '@neoworks/extension-system';
import {
	keysBetween,
	planSetProps,
	type Change,
	type DocumentReader,
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

interface DropPlan {
	targetId: NodeId;
	/** Set when the target is an auto layout frame. */
	slot: DropSlot | null;
}

export class ReorderDrag implements MoveDrag {
	private pinned = false;
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
		let line: DropSlot['line'] | null = null;
		if (plan.slot !== null) line = plan.slot.line;
		this.feedback.reorder = {
			targetId: plan.targetId,
			line,
			ghosts: this.ghosts(world)
		};
	}

	commit(): void {
		const plan = this.plan(this.lastWorld);
		this.feedback.reorder = null;
		const changes = this.changesFor(plan);
		if (changes.length === 0) return;
		this.ctx.document.apply(changes, { origin: 'user', label: this.label(plan) });
	}

	cancel(): void {
		this.feedback.reorder = null;
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
		return findContainer(source, this.ctx.document.currentPageId, world);
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
		return dropSlot({
			mode: frame.layoutMode,
			wrap: frame.layoutWrap === 'WRAP',
			rects,
			inner,
			point: world
		});
	}

	private ghosts(world: Point): Rect[] {
		const dx = world.x - this.startWorld.x;
		const dy = world.y - this.startWorld.y;
		return this.ids.map((id) => {
			const bounds = this.ctx.document.absoluteBounds(id);
			return { ...bounds, x: bounds.x + dx, y: bounds.y + dy };
		});
	}

	// ---------- the drop ----------

	private label(plan: DropPlan): string {
		if (plan.slot === null) return 'Move';
		return 'Reorder';
	}

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
		const items = this.ids.map((id) => ({ id, origin: reader.cache.absoluteTransform(id) }));
		const changes = planDrag(reader, items, delta, () => targetId);
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
