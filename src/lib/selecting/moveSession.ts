// One move gesture over the selection (issue #51). The session opens a history group when the
// drag starts, applies the planned changes on every pointer move (a live preview that is real
// document state), and either closes the group (one undo step) or cancels it (no trace).
//
//   Shift   keep the larger component of the movement
//   Alt     drag a duplicate; the originals stay (decided when the drag starts)
//   Space   pin every node to the container it started in (no nesting into or out of frames)
//   Ctrl    no snapping
//
// Each node goes into the deepest frame under the pointer (not under the node). A node inside a
// group keeps the group while the pointer stays over the group's frame. Ctrl pins like Space. Auto layout frames are never drop targets
// and auto layout children never move here: the `autolayout-handles` plugin takes over the drag
// (the `move/begin` event, see moveDrag.ts) and reorders them.

import type { Context } from '@neoworks/extension-system';
import { cloneSubtree, isFrameLike, type Change, type NodeId, type Rect } from '../document';
import { findContainer, type NestingSource } from '../tools/creation';
import { nestingSource } from '../editing/creationTool.svelte';
import { topLevelIds, unionBounds } from '../editing/selectionOps';
import type { Modifiers, Point } from '../tools/protocol';
import { axisFor, constrainToAxis, draggableIds, planDrag, type DragItem } from './drag';
import type { MoveDrag } from './moveDrag';

/** The ui state the session reports to the overlay. */
export interface MoveFeedback {
	dropTargetId: NodeId | null;
}

export class MoveSession implements MoveDrag {
	private readonly items: DragItem[] = [];
	private readonly originalParents = new Map<NodeId, NodeId>();
	// One array per set of dragged nodes: snapping keeps its candidates while it gets the same one.
	private draggedIds: NodeId[] = [];
	private readonly group: ReturnType<Context['history']['beginGroup']>;
	private initialBounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private pinned = false;
	private duplicated = false;
	private axis: 'x' | 'y' | undefined;
	private lastWorld: Point;
	private lastModifiers: Modifiers;

	private constructor(
		private readonly ctx: Context,
		private readonly feedback: MoveFeedback,
		private readonly startWorld: Point,
		modifiers: Modifiers
	) {
		this.lastWorld = startWorld;
		this.lastModifiers = modifiers;
		this.group = ctx.history.beginGroup({ label: 'Move' });
	}

	/** Start dragging the selection; undefined when nothing in it can move. */
	static begin(
		ctx: Context,
		feedback: MoveFeedback,
		startWorld: Point,
		modifiers: Modifiers
	): MoveSession | undefined {
		const reader = ctx.document.reader;
		const movable = draggableIds(reader, topLevelIds(reader, ctx.selection.ids));
		if (movable.length === 0) return undefined;
		const session = new MoveSession(ctx, feedback, startWorld, modifiers);
		let ids = movable;
		if (modifiers.altKey) {
			session.duplicated = true;
			ids = session.duplicate(movable);
		}
		session.capture(ids);
		session.initialBounds = session.measureStart();
		return session;
	}

	setPinned(pinned: boolean): void {
		this.pinned = pinned;
		this.update(this.lastWorld, this.lastModifiers);
	}

	/**
	 * Alt pressed during a plain drag: the copy appears where the pointer is and is what moves on,
	 * the originals return to where they started.
	 */
	duplicateNow(): void {
		if (this.duplicated) return;
		this.duplicated = true;
		const originals = [...this.items];
		const originalParents = new Map(this.originalParents);
		const copies = this.duplicate(originals.map((item) => item.id));
		const restore = planDrag(
			this.ctx.document.reader,
			originals,
			{ x: 0, y: 0 },
			(id) => originalParents.get(id) ?? this.ctx.document.currentPageId
		);
		this.ctx.document.apply(restore, { origin: 'user', label: 'Move' });
		this.items.length = 0;
		this.originalParents.clear();
		copies.forEach((copyId, position) => {
			const original = originals[position];
			this.items.push({ id: copyId, origin: original.origin });
			this.originalParents.set(copyId, originalParents.get(original.id) ?? '');
		});
		this.draggedIds = this.items.map((item) => item.id);
		this.update(this.lastWorld, this.lastModifiers);
	}

	/** Re-plan with new modifier state when no pointer move arrives (Shift pressed while still). */
	refresh(modifiers: Modifiers): void {
		this.update(this.lastWorld, modifiers);
	}

	update(world: Point, modifiers: Modifiers): void {
		this.lastWorld = world;
		this.lastModifiers = modifiers;
		const delta = this.snappedDelta(world, modifiers);
		// The drop frame depends on the pointer only, so it is found once per move, not per node.
		const target = this.dropTarget();
		const nearestContainers = new Map<NodeId, NodeId>();
		const changes = planDrag(this.ctx.document.reader, this.items, delta, (id) =>
			this.containerFor(id, target, nearestContainers)
		);
		if (changes.length > 0) this.ctx.document.apply(changes, { origin: 'user', label: 'Move' });
		this.reportDropTarget();
	}

	commit(): void {
		this.ctx.snapping.release();
		this.feedback.dropTargetId = null;
		this.ctx.history.endGroup(this.group);
	}

	cancel(): void {
		this.ctx.snapping.release();
		this.feedback.dropTargetId = null;
		this.ctx.history.cancelGroup(this.group);
	}

	private duplicate(ids: NodeId[]): NodeId[] {
		const reader = this.ctx.document.reader;
		const changes: Change[] = [];
		const copies: NodeId[] = [];
		for (const id of ids) {
			const clone = cloneSubtree(reader, id);
			changes.push(...clone.changes);
			copies.push(clone.rootId);
		}
		this.ctx.document.apply(changes, { origin: 'user', label: 'Duplicate' });
		this.ctx.selection.select(copies, 'replace', { source: 'canvas' });
		return copies;
	}

	private capture(ids: NodeId[]): void {
		const reader = this.ctx.document.reader;
		for (const id of ids) {
			const node = reader.requireNode(id);
			if (node.parentId === null) continue;
			this.originalParents.set(id, node.parentId);
			this.items.push({ id, origin: reader.cache.absoluteTransform(id) });
		}
		this.draggedIds = this.items.map((item) => item.id);
	}

	private measureStart(): Rect {
		const reader = this.ctx.document.reader;
		return unionBounds(
			this.items.map((item) => {
				const node = reader.requireNode(item.id);
				return reader.cache.absoluteBounds(node.id);
			})
		);
	}

	private snappedDelta(world: Point, modifiers: Modifiers): Point {
		// Whole canvas pixels, before snapping (Figma snaps the rounded position).
		let delta = {
			x: Math.round(world.x - this.startWorld.x),
			y: Math.round(world.y - this.startWorld.y)
		};
		const constrained = modifiers.shiftKey;
		if (constrained) {
			this.axis = axisFor(delta, this.axis);
			delta = constrainToAxis(delta, this.axis);
		} else {
			this.axis = undefined;
		}
		const start = this.initialBounds;
		const moving = { x: start.x + delta.x, y: start.y + delta.y, ...sizeOf(start) };
		const outcome = this.ctx.snapping.snap(moving, {
			ignoreIds: this.draggedIds,
			parentId: this.snapParentId(),
			axes: this.axis === undefined ? 'both' : this.axis,
			bypass: modifiers.ctrlKey || modifiers.metaKey
		});
		return { x: delta.x + outcome.delta.x, y: delta.y + outcome.delta.y };
	}

	private snapParentId(): NodeId {
		const parents = new Set(this.originalParents.values());
		const [only] = parents;
		if (parents.size === 1) return only;
		return this.ctx.document.currentPageId;
	}

	/** The frame under the pointer, or undefined while nodes stay in their containers. */
	private dropTarget(): NodeId | undefined {
		if (this.pinned) return undefined;
		if (this.lastModifiers.ctrlKey || this.lastModifiers.metaKey) return undefined;
		const dragged = new Set(this.draggedIds);
		const found = findContainer(
			excluding(nestingSource(this.ctx), dragged),
			this.ctx.document.currentPageId,
			this.lastWorld
		);
		if (this.isAutoLayout(found)) return undefined;
		return found;
	}

	private containerFor(
		id: NodeId,
		target: NodeId | undefined,
		nearestContainers: Map<NodeId, NodeId>
	): NodeId {
		const originalParentId = this.originalParents.get(id);
		if (originalParentId === undefined) return this.ctx.document.currentPageId;
		if (target === undefined) return originalParentId;
		let nearest = nearestContainers.get(originalParentId);
		if (nearest === undefined) {
			nearest = this.nearestContainer(originalParentId);
			nearestContainers.set(originalParentId, nearest);
		}
		if (target === nearest) return originalParentId;
		return target;
	}

	/** The frame or page a group (or frame) parent sits in, including the parent itself. */
	private nearestContainer(parentId: NodeId): NodeId {
		const reader = this.ctx.document.reader;
		const chain = [reader.requireNode(parentId), ...reader.ancestors(parentId)];
		const found = chain.find((node) => node.type === 'PAGE' || isFrameLike(node));
		if (found === undefined) return this.ctx.document.currentPageId;
		return found.id;
	}

	private isAutoLayout(id: NodeId): boolean {
		const node = this.ctx.document.require(id);
		if (!('layoutMode' in node)) return false;
		return node.layoutMode !== 'NONE';
	}

	private reportDropTarget(): void {
		const [first] = this.items;
		if (first === undefined) return;
		const parentId = this.ctx.document.require(first.id).parentId;
		const original = this.originalParents.get(first.id);
		const changed = parentId !== original && parentId !== this.ctx.document.currentPageId;
		this.feedback.dropTargetId = changed ? parentId : null;
	}
}

function sizeOf(rect: Rect): { width: number; height: number } {
	return { width: rect.width, height: rect.height };
}

function excluding(source: NestingSource, excluded: ReadonlySet<NodeId>): NestingSource {
	return {
		...source,
		children: (id) => source.children(id).filter((child) => !excluded.has(child))
	};
}
