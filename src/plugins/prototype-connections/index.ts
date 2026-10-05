import type { Context } from '@neoworks/extension-system';
import {
	ConnectionClaimant,
	connectionScreenCurve,
	handleOwner,
	prototypeTabActive,
	screenRectOf
} from '../../lib/prototype/connectionClaimant';
import { dragCurve } from '../../lib/prototype/connections';
import {
	drawConnection,
	drawFlowBadge,
	drawHandle,
	drawTargetOutline
} from '../../lib/prototype/draw';
import type { OverlayFrame } from '../../lib/overlay/types';

function drawConnections(ctx: Context, frame: OverlayFrame): void {
	const selected = ctx.prototyping.state.selectedConnection;
	for (const connection of ctx.prototyping.connections()) {
		const isSelected =
			selected !== null &&
			selected.nodeId === connection.sourceId &&
			selected.index === connection.reactionIndex;
		const curve = connectionScreenCurve(ctx, connection);
		drawConnection(frame.ctx, { curve, selected: isSelected, pending: false });
	}
}

function drawFlowBadges(ctx: Context, frame: OverlayFrame): void {
	for (const flow of ctx.prototyping.flows()) {
		drawFlowBadge(frame.ctx, screenRectOf(ctx, flow.nodeId), flow.name);
	}
}

function drawHandleAndDrag(ctx: Context, frame: OverlayFrame): void {
	const drag = ctx.prototyping.state.drag;
	const owner = handleOwner(ctx);
	if (owner !== undefined) drawHandle(frame.ctx, screenRectOf(ctx, owner), drag !== null);
	if (drag === null) return;
	const pointer = ctx.viewport.worldToScreen(drag.world);
	const sourceRect = screenRectOf(ctx, drag.sourceId);
	if (drag.targetId === null) {
		drawConnection(frame.ctx, {
			curve: dragCurve(sourceRect, pointer),
			selected: false,
			pending: true
		});
		return;
	}
	drawTargetOutline(frame.ctx, screenRectOf(ctx, drag.targetId));
	drawConnection(frame.ctx, {
		curve: dragCurve(sourceRect, pointer),
		selected: false,
		pending: false
	});
}

// Prototype connections (#122): while the Prototype tab is showing, the selected node gets a round
// handle on its right edge; dragging it onto a top-level frame creates or retargets the node's
// navigate interaction. Arrows are drawn between the nodes and their destination frames, a press on
// one selects it (Delete removes it, see prototype-panel), and flow starting frames carry a badge.
// Everything drawn comes from document data (`reactions`, `flowStartingPoints`); nothing is stored
// here.
export default {
	name: 'prototype-connections',
	inject: ['overlay', 'canvasInput', 'prototyping', 'viewport', 'panels', 'document', 'selection'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'prototype-connections/draw',
					order: 40,
					track: () => {
						void prototypeTabActive(ctx);
						void ctx.prototyping.connections();
						void ctx.prototyping.flows();
						void ctx.prototyping.state.drag;
						void ctx.prototyping.state.selectedConnection;
					},
					draw: (frame) => {
						if (!prototypeTabActive(ctx)) return;
						drawFlowBadges(ctx, frame);
						drawConnections(ctx, frame);
						drawHandleAndDrag(ctx, frame);
					}
				}),
			'prototype connections overlay'
		);
		ctx.effect(
			() => ctx.canvasInput.claim(new ConnectionClaimant(ctx)),
			'prototype connection claim'
		);
	}
};
