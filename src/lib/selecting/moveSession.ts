// One move gesture over the selection (issue #51). The session opens a history group when the
// drag starts, applies the planned changes on every pointer move (a live preview that is real
// document state), and either closes the group (one undo step) or cancels it (no trace).
//
//   Shift   keep the larger component of the movement
//   Alt     drag a duplicate; the originals stay (decided when the drag starts)
//   Space   pin every node to the container it started in (no nesting into or out of frames)
//   Ctrl    no snapping
//
// Each node goes into the deepest frame under its own centre. A node inside a group keeps the
// group while its centre stays over the group's frame. Auto layout frames are never drop targets
// and auto layout children never move here: the `autolayout-handles` plugin takes over the drag
// (the `move/begin` event, see moveDrag.ts) and reorders them.

import type { Context } from '@neoworks/extension-system';
import { cloneSubtree, isFrameLike, type Change, type NodeId, type Rect } from '../document';
import { findContainer, type NestingSource } from '../tools/creation';
import { nestingSource } from '../editing/creationTool.svelte';
import { topLevelIds, unionBounds } from '../editing/selectionOps';
import type { Modifiers, Point } from '../tools/protocol';
import { constrainToAxis, draggableIds, lockedAxis, planDrag, type DragItem } from './drag';
import type { MoveDrag } from './moveDrag';

/** The ui state the session reports to the overlay. */
export interface MoveFeedback {
	dropTargetId: NodeId | null;
}

export class MoveSession implements MoveDrag {
	private readonly items: DragItem[] = [];
	private readonly originalParents = new Map<NodeId, NodeId>();
	private readonly group: ReturnType<Context['history']['beginGroup']>;
	private initialBounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private pinned = false;
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
		if (modifiers.altKey) ids = session.duplicate(movable);
		session.capture(ids);
		session.initialBounds = session.measureStart();
		return session;
	}

	setPinned(pinned: boolean): void {
		this.pinned = pinned;
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
		const changes = planDrag(this.ctx.document.reader, this.items, delta, (id, bounds) =>
			this.containerFor(id, bounds)
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
		let delta = { x: world.x - this.startWorld.x, y: world.y - this.startWorld.y };
		const constrained = modifiers.shiftKey;
		if (constrained) delta = constrainToAxis(delta);
		const start = this.initialBounds;
		const moving = { x: start.x + delta.x, y: start.y + delta.y, ...sizeOf(start) };
		const outcome = this.ctx.snapping.snap(moving, {
			ignoreIds: this.items.map((item) => item.id),
			parentId: this.snapParentId(),
			axes: constrained ? lockedAxis(delta) : 'both',
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

	private containerFor(id: NodeId, bounds: Rect): NodeId {
		const originalParentId = this.originalParents.get(id);
		if (originalParentId === undefined) return this.ctx.document.currentPageId;
		if (this.pinned) return originalParentId;
		const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
		const dragged = new Set(this.items.map((item) => item.id));
		const found = findContainer(
			excluding(nestingSource(this.ctx), dragged),
			this.ctx.document.currentPageId,
			center
		);
		if (found === this.nearestContainer(originalParentId)) return originalParentId;
		if (this.isAutoLayout(found)) return originalParentId;
		return found;
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
