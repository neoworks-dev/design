// Pointer input of the Prototype tab on the canvas: a press on the connection handle of the
// selected node starts dragging a connection, a press on an arrow selects it. A claimant, so the
// canvas input router gives these presses to us before the active tool (the same mechanism as the
// comment pins). Active only while the Prototype tab is the one showing.

import type { Context } from '@neoworks/extension-system';
import type { NodeId, Rect } from '../document/types';
import type { PointerClaimant, PointerGrab } from '../tools/claim';
import type { ToolPointerEvent } from '../tools/protocol';
import {
	connectionCurve,
	containsPoint,
	distanceToCurve,
	hitsHandle,
	PICK_TOLERANCE,
	type Curve,
	type Point
} from './connections';
import type { Connection } from './model';

const PRIMARY_BUTTON = 0;
export const PROTOTYPE_TAB_ID = 'prototype';

export function prototypeTabActive(ctx: Context): boolean {
	return ctx.panels.activeTab('right')?.id === PROTOTYPE_TAB_ID;
}

/** The node's rectangle in canvas pixels. */
export function screenRectOf(ctx: Context, nodeId: NodeId): Rect {
	const bounds = ctx.document.absoluteBounds(nodeId);
	const origin = ctx.viewport.worldToScreen({ x: bounds.x, y: bounds.y });
	const corner = ctx.viewport.worldToScreen({
		x: bounds.x + bounds.width,
		y: bounds.y + bounds.height
	});
	return { x: origin.x, y: origin.y, width: corner.x - origin.x, height: corner.y - origin.y };
}

/** The single selected node that can carry interactions: the owner of the handle. */
export function handleOwner(ctx: Context): NodeId | undefined {
	if (ctx.selection.ids.length !== 1) return undefined;
	const node = ctx.document.get(ctx.selection.ids[0]);
	if (node === undefined || !('reactions' in node)) return undefined;
	return node.id;
}

export function connectionScreenCurve(ctx: Context, connection: Connection): Curve {
	return connectionCurve(
		screenRectOf(ctx, connection.sourceId),
		screenRectOf(ctx, connection.destinationId)
	);
}

export class ConnectionClaimant implements PointerClaimant {
	readonly id = 'prototype-connections/handles';
	readonly order = -4;

	constructor(private readonly ctx: Context) {}

	claim(event: ToolPointerEvent): PointerGrab | undefined {
		if (event.button !== PRIMARY_BUTTON || !prototypeTabActive(this.ctx)) return undefined;
		const sourceId = this.handleAt(event.screen);
		if (sourceId !== undefined) return this.dragFrom(sourceId, event.world);
		const connection = this.arrowAt(event.screen);
		if (connection === undefined) return undefined;
		return {
			move: () => {},
			up: () =>
				this.ctx.prototyping.selectConnection({
					nodeId: connection.sourceId,
					index: connection.reactionIndex
				}),
			cancel: () => {}
		};
	}

	cursorAt(event: ToolPointerEvent): string | undefined {
		if (!prototypeTabActive(this.ctx)) return undefined;
		if (this.handleAt(event.screen) !== undefined) return 'crosshair';
		if (this.arrowAt(event.screen) !== undefined) return 'pointer';
		return undefined;
	}

	private handleAt(screen: Point): NodeId | undefined {
		const owner = handleOwner(this.ctx);
		if (owner === undefined) return undefined;
		if (!hitsHandle(screenRectOf(this.ctx, owner), screen)) return undefined;
		return owner;
	}

	private arrowAt(screen: Point): Connection | undefined {
		const connections = this.ctx.prototyping.connections();
		let nearest: Connection | undefined;
		let nearestDistance = PICK_TOLERANCE;
		for (const connection of connections) {
			const distance = distanceToCurve(connectionScreenCurve(this.ctx, connection), screen);
			if (distance > nearestDistance) continue;
			nearest = connection;
			nearestDistance = distance;
		}
		return nearest;
	}

	private screenAt(world: Point, sourceId: NodeId): NodeId | null {
		const screens = this.ctx.prototyping.screens();
		const ownScreenId = this.ctx.prototyping.screenOf(sourceId);
		for (let index = screens.length - 1; index >= 0; index -= 1) {
			const screen = screens[index];
			if (screen.id === ownScreenId) continue;
			if (containsPoint(this.ctx.document.absoluteBounds(screen.id), world)) return screen.id;
		}
		return null;
	}

	private dragFrom(sourceId: NodeId, world: Point): PointerGrab {
		const state = this.ctx.prototyping.state;
		const update = (point: Point): void => {
			state.drag = { sourceId, world: point, targetId: this.screenAt(point, sourceId) };
		};
		update(world);
		return {
			move: (event) => update(event.world),
			up: (event) => {
				const targetId = this.screenAt(event.world, sourceId);
				state.drag = null;
				if (targetId === null) return;
				this.ctx.prototyping.connect(sourceId, targetId);
			},
			cancel: () => {
				state.drag = null;
			}
		};
	}
}
