// The click-drag creation tool shared by the shape tools and the frame tool: press, drag with a
// live preview, release creates ONE node in ONE undo step, selects it and finishes the operation
// (the tool reverts to Move unless locked). Modifier rules live in lib/tools/creation.ts.

import type { Context } from '@neoworks/extension-system';
import type { Matrix2x3, NodeId, Rect } from '../document/types';
import { keyBetween } from '../document/fractionalIndex';
import { identityMatrix } from '../document/matrix';
import { rgbaCss } from '../ui/colorMath';
import type { ToolContribution } from '../registries/tools.svelte';
import {
	boxPlacement,
	clickBounds,
	clickLine,
	dragBounds,
	dragLine,
	findContainer,
	linePlacement,
	nextName,
	type DragModifiers,
	type LocalPlacement,
	type LineSegment,
	type NestingSource
} from '../tools/creation';
import { PointerGesture, type Point, type ToolPointerEvent } from '../tools/protocol';
import { applyEdit } from './contribute';
import type { PositionedNode } from './selectionOps';

export type PreviewShape = { kind: 'box'; rect: Rect } | { kind: 'line'; from: Point; to: Point };

/** What the overlay draws while a creation drag runs, in canvas pixels. */
export class CreationPreview {
	shape = $state.raw<PreviewShape | null>(null);
	/** The node type being drawn, for the overlay to pick an outline (ellipse is round). */
	nodeType = $state('RECTANGLE');
	/** CSS colour of the node's first visible solid fill, so the preview looks like the result. */
	fill = $state<string | null>(null);
}

/** The fill the tool's nodes get, as CSS, from a node built the way the tool builds it. */
function previewFill(spec: CreationToolSpec): string | null {
	const sample = spec.build({ transform: identityMatrix(), width: 1, height: 1 }, spec.label);
	if (!('fills' in sample)) return null;
	const solid = sample.fills.find((paint) => paint.visible !== false && paint.type === 'SOLID');
	if (solid === undefined || solid.type !== 'SOLID') return null;
	return rgbaCss(solid.color, solid.opacity ?? 1);
}

export interface CreationToolSpec {
	/** Type of the node created; also drives the preview outline. */
	nodeType: PositionedNode['type'];
	/** Base of the auto name: "Rectangle" gives "Rectangle 1", "Rectangle 2", ... */
	label: string;
	geometry: 'box' | 'line';
	/** Node for `placement` inside its container; parent and index are filled in by the tool. */
	build(placement: LocalPlacement, name: string): PositionedNode;
	/** Where the node goes: the frame under the pointer (default) or always the page (sections). */
	container?: 'nearest-frame' | 'page';
	/** Size of a click-created box; defaults to 100 x 100. */
	clickSize?: () => { width: number; height: number };
	/** A name that replaces the auto name for the next node (a frame preset), if any. */
	nameOverride?: () => string | undefined;
	/** Called after the node was created and selected. */
	onCreated?: (node: PositionedNode) => void;
}

type CreationHandlers = Pick<
	ToolContribution,
	'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onCancel' | 'onDeactivate' | 'onActivate'
>;

const PRIMARY_BUTTON = 0;

export function createCreationTool(
	ctx: Context,
	spec: CreationToolSpec,
	preview: CreationPreview
): CreationHandlers {
	const gesture = new PointerGesture();
	let startScreen: Point = { x: 0, y: 0 };
	let startWorld: Point = { x: 0, y: 0 };

	const stop = (): void => {
		gesture.cancel();
		preview.shape = null;
		ctx.emit('tools/snap-release');
	};

	return {
		onActivate(): void {
			preview.nodeType = spec.nodeType;
			preview.fill = previewFill(spec);
		},
		onPointerDown(event: ToolPointerEvent): void {
			if (event.button !== PRIMARY_BUTTON) return;
			startScreen = event.screen;
			startWorld = snapPoint(ctx, event.world);
			gesture.press(event.screen);
		},
		onPointerMove(event: ToolPointerEvent): void {
			if (gesture.phase === 'idle') return;
			const update = gesture.move(event.screen);
			if (update.phase !== 'dragging') return;
			snapPoint(ctx, event.world);
			preview.shape = shapeBetween(spec.geometry, startScreen, event.screen, event);
		},
		onPointerUp(event: ToolPointerEvent): void {
			const result = gesture.release();
			preview.shape = null;
			if (result === 'none') return;
			const snapped = {
				...event,
				world: result === 'drag' ? snapPoint(ctx, event.world) : event.world
			};
			ctx.emit('tools/snap-release');
			createNode(ctx, spec, prepare(ctx, spec, result, startWorld, snapped));
		},
		onDeactivate: stop,
		onCancel(): boolean {
			if (gesture.phase === 'idle') return false;
			stop();
			return true;
		}
	};
}

function snapPoint(ctx: Context, point: Point): Point {
	return ctx.waterfall('tools/snap-point', point, () => point);
}

function shapeBetween(
	geometry: 'box' | 'line',
	start: Point,
	end: Point,
	modifiers: DragModifiers
): PreviewShape {
	if (geometry === 'line') {
		const segment = dragLine(start, end, modifiers);
		return { kind: 'line', from: segment.from, to: segment.to };
	}
	return { kind: 'box', rect: dragBounds(start, end, modifiers) };
}

type WorldShape = { kind: 'box'; rect: Rect } | { kind: 'line'; segment: LineSegment };

interface Prepared {
	shape: WorldShape;
	container: NodeId;
	parentAbsolute: Matrix2x3;
}

function worldShape(
	spec: CreationToolSpec,
	result: 'click' | 'drag',
	start: Point,
	event: ToolPointerEvent
): WorldShape {
	if (spec.geometry === 'line') {
		if (result === 'click') return { kind: 'line', segment: clickLine(start) };
		return { kind: 'line', segment: dragLine(start, event.world, event) };
	}
	if (result === 'click') return { kind: 'box', rect: clickRect(spec, start) };
	return { kind: 'box', rect: dragBounds(start, event.world, event) };
}

function clickRect(spec: CreationToolSpec, start: Point): Rect {
	if (!spec.clickSize) return clickBounds(start);
	const size = spec.clickSize();
	return { x: start.x, y: start.y, width: size.width, height: size.height };
}

function prepare(
	ctx: Context,
	spec: CreationToolSpec,
	result: 'click' | 'drag',
	start: Point,
	event: ToolPointerEvent
): Prepared {
	const shape = worldShape(spec, result, start, event);
	let container = ctx.document.currentPageId;
	if (spec.container !== 'page') {
		container = findContainer(nestingSource(ctx), ctx.document.currentPageId, start);
	}
	return { shape, container, parentAbsolute: absoluteTransformOf(ctx, container) };
}

function absoluteTransformOf(ctx: Context, id: NodeId): Matrix2x3 {
	if (ctx.document.require(id).type === 'PAGE') return identityMatrix();
	return ctx.document.absoluteTransform(id);
}

const FRAME_LIKE_TYPES: readonly string[] = ['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET'];

export function nestingSource(ctx: Context): NestingSource {
	return {
		children: (id) => ctx.document.children(id),
		describe: (id) => {
			const node = ctx.document.get(id);
			if (!node) return undefined;
			if (node.type === 'PAGE') return undefined;
			return {
				frameLike: FRAME_LIKE_TYPES.includes(node.type),
				visible: node.visible,
				locked: node.locked
			};
		},
		absoluteBounds: (id) => ctx.document.absoluteBounds(id)
	};
}

function placementOf(prepared: Prepared): LocalPlacement {
	if (prepared.shape.kind === 'line') {
		return linePlacement(prepared.shape.segment, prepared.parentAbsolute);
	}
	return boxPlacement(prepared.shape.rect, prepared.parentAbsolute);
}

function nameFor(ctx: Context, spec: CreationToolSpec): string {
	const override = spec.nameOverride?.();
	if (override !== undefined) return override;
	const existing = ctx.document
		.query((node) => node.type === spec.nodeType, ctx.document.currentPageId)
		.map((node) => node.name);
	return nextName(spec.label, existing);
}

function lastIndexIn(ctx: Context, containerId: NodeId): string | null {
	const lastSibling = ctx.document.childNodes(containerId).at(-1);
	if (!lastSibling) return null;
	return lastSibling.index;
}

function createNode(ctx: Context, spec: CreationToolSpec, prepared: Prepared): void {
	const built = spec.build(placementOf(prepared), nameFor(ctx, spec));
	const index = keyBetween(lastIndexIn(ctx, prepared.container), null);
	const node: PositionedNode = { ...built, parentId: prepared.container, index };
	applyEdit(ctx, ctx.document.insertNode(node), `Create ${spec.label}`);
	ctx.selection.select([node.id]);
	spec.onCreated?.(node);
	ctx.tools.completeOperation();
}
