// Pointer handling for the rulers and guides (#72), as two pointer claimants so the canvas input
// router (not a DOM hit area) decides who gets a press:
//
//   ruler claimant   a press on a ruler starts a new guide (top ruler: horizontal, left: vertical)
//   guide claimant   a press on a guide line moves it; ranks below the transform handles
//
// Releasing over the ruler the drag came from deletes the guide (a new one is simply dropped).
// A new guide belongs to the top-level frame it is dropped in, else to the page. Every change is
// one `document.apply`, so it is one undo step.

import type { Context } from '@neoworks/extension-system';
import { applyEdit } from '../editing/contribute';
import type { PointerClaimant, PointerGrab } from '../tools/claim';
import type { Point, ToolPointerEvent } from '../tools/protocol';
import { RULER_SIZE } from './draw';
import {
	guideOwnerAt,
	placedGuides,
	planAddGuide,
	planMoveGuide,
	planRemoveGuide,
	type GuideRef,
	type PlacedGuide
} from './guides';

const PRIMARY_BUTTON = 0;
const GUIDE_HIT_PIXELS = 4;

type Axis = 'X' | 'Y';

function inRulerBand(screen: Point, axis: Axis): boolean {
	if (axis === 'Y') return screen.y < RULER_SIZE;
	return screen.x < RULER_SIZE;
}

function coordinateOf(point: Point, axis: Axis): number {
	if (axis === 'X') return point.x;
	return point.y;
}

function cursorFor(axis: Axis): string {
	if (axis === 'X') return 'col-resize';
	return 'row-resize';
}

abstract class GuideClaimant implements PointerClaimant {
	abstract readonly id: string;
	abstract readonly order: number;

	constructor(protected readonly ctx: Context) {}

	protected abstract start(
		screen: Point
	): { axis: Axis; moving?: GuideRef; at: number } | undefined;

	claim(event: ToolPointerEvent): PointerGrab | undefined {
		if (event.button !== PRIMARY_BUTTON) return undefined;
		const started = this.start(event.screen);
		if (started === undefined) return undefined;
		const { axis, moving } = started;
		this.ctx.rulersGuides.setDraft({
			axis,
			position: started.at,
			overRuler: inRulerBand(event.screen, axis),
			moving
		});
		return {
			move: (move) => this.drag(axis, moving, move),
			up: (up) => this.drop(axis, moving, up),
			cancel: () => this.ctx.rulersGuides.setDraft(null)
		};
	}

	cursorAt(event: ToolPointerEvent): string | undefined {
		const started = this.start(event.screen);
		if (started === undefined) return undefined;
		return cursorFor(started.axis);
	}

	private drag(axis: Axis, moving: GuideRef | undefined, event: ToolPointerEvent): void {
		this.ctx.rulersGuides.setDraft({
			axis,
			position: Math.round(coordinateOf(event.world, axis)),
			overRuler: inRulerBand(event.screen, axis),
			moving
		});
	}

	private drop(axis: Axis, moving: GuideRef | undefined, event: ToolPointerEvent): void {
		this.ctx.rulersGuides.setDraft(null);
		const reader = this.ctx.document.reader;
		const position = Math.round(coordinateOf(event.world, axis));
		const overRuler = inRulerBand(event.screen, axis);
		if (moving !== undefined && overRuler) {
			applyEdit(this.ctx, planRemoveGuide(reader, moving), 'Delete guide');
			return;
		}
		if (overRuler) return;
		if (moving !== undefined) {
			applyEdit(this.ctx, planMoveGuide(reader, moving, position), 'Move guide');
			return;
		}
		const owner = guideOwnerAt(reader, this.ctx.document.currentPageId, event.world);
		applyEdit(this.ctx, planAddGuide(reader, owner, axis, position), 'Create guide');
	}
}

/** A press on a ruler creates a guide. */
export class RulerClaimant extends GuideClaimant {
	readonly id = 'rulers-guides/rulers';
	readonly order = -10;

	protected start(screen: Point): { axis: Axis; at: number } | undefined {
		if (!this.ctx.rulersGuides.rulersVisible) return undefined;
		const top = screen.y < RULER_SIZE && screen.x >= RULER_SIZE;
		const left = screen.x < RULER_SIZE && screen.y >= RULER_SIZE;
		if (!top && !left) return undefined;
		const axis: Axis = top ? 'Y' : 'X';
		const world = this.ctx.viewport.screenToWorld(screen);
		return { axis, at: Math.round(coordinateOf(world, axis)) };
	}
}

/** A press on a visible guide line moves it. */
export class GuideLineClaimant extends GuideClaimant {
	readonly id = 'rulers-guides/guides';
	readonly order = 10;

	protected start(screen: Point): { axis: Axis; moving: GuideRef; at: number } | undefined {
		// Guides can only be grabbed while the rulers show, so a guide never steals a click on an
		// object whose edge snapped to it.
		if (!this.ctx.rulersGuides.guidesVisible || !this.ctx.rulersGuides.rulersVisible) {
			return undefined;
		}
		if (screen.x < RULER_SIZE || screen.y < RULER_SIZE) return undefined;
		const hit = this.guideAt(screen);
		if (hit === undefined) return undefined;
		return { axis: hit.axis, moving: { ownerId: hit.ownerId, index: hit.index }, at: hit.position };
	}

	private guideAt(screen: Point): PlacedGuide | undefined {
		const guides = placedGuides(this.ctx.document.reader, this.ctx.document.currentPageId);
		const world = this.ctx.viewport.screenToWorld(screen);
		const tolerance = GUIDE_HIT_PIXELS / this.ctx.viewport.zoom;
		return guides.find((guide) => {
			if (Math.abs(coordinateOf(world, guide.axis) - guide.position) > tolerance) return false;
			if (guide.span === undefined) return true;
			const along = coordinateOf(world, guide.axis === 'X' ? 'Y' : 'X');
			return along >= guide.span.start && along <= guide.span.end;
		});
	}
}
