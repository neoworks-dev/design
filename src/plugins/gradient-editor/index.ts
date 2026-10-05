import type { Context } from '@neoworks/extension-system';
import type { NodeId } from '../../lib/document';
import { moveHandle, moveStop, positionAlongAxis } from '../../lib/editing/gradient';
import { hitTarget, NodeSpace, type HandleTarget } from '../../lib/editing/gradientCanvas';
import { GradientEditorService, GRADIENT_TOOL_ID } from '../../lib/services/gradientEditor';
import { GradientEditorState } from '../../lib/services/gradientEditorState.svelte';
import { drawGradientHandles } from './drawHandles';
import GradientEditorHost from './GradientEditorHost.svelte';

const HIT_RADIUS_PX = 9;

function spaceOf(ctx: Context, nodeId: NodeId): NodeSpace | undefined {
	const node = ctx.document.get(nodeId);
	if (node === undefined || !('width' in node) || !('height' in node)) return undefined;
	return new NodeSpace(ctx.document.absoluteTransform(nodeId), {
		width: node.width,
		height: node.height
	});
}

// The `gradientEditor` service: the popover (type, stops, reverse, rotate), the on-canvas handles
// drawn through `overlay`, and a hidden canvas tool that makes them draggable. The tool is active
// exactly while the editor is open; Esc leaves it.
export default {
	name: 'gradient-editor',
	inject: ['regions', 'overlay', 'tools', 'colorPicker', 'document', 'viewport', 'selection'],
	apply(ctx: Context): void {
		const editor = new GradientEditorService(ctx, new GradientEditorState());
		let dragging: HandleTarget | undefined;

		function dragTo(target: HandleTarget, world: { x: number; y: number }): void {
			const request = editor.state.current;
			if (request === null) return;
			const space = spaceOf(ctx, request.nodeId);
			if (space === undefined) return;
			const point = space.toNormalized(world);
			editor.edit((paint) => {
				if (target.kind === 'handle') return moveHandle(paint, target.handle, point);
				const position = positionAlongAxis(paint, point);
				return {
					...paint,
					gradientStops: moveStop(paint.gradientStops, target.index, position)
				};
			}, 'scrub');
		}

		ctx.effect(() => () => editor.close(), 'gradient editor closes');

		ctx.effect(
			() =>
				ctx.tools.register({
					id: GRADIENT_TOOL_ID,
					title: 'Edit gradient',
					toolbar: false,
					cursor: 'default',
					onPointerDown: (event) => {
						const request = editor.state.current;
						const paint = editor.paint;
						if (request === null || paint === undefined) return;
						const space = spaceOf(ctx, request.nodeId);
						if (space === undefined) return;
						const target = hitTarget(paint, space, event.world, HIT_RADIUS_PX / ctx.viewport.zoom);
						if (target === undefined) {
							editor.close();
							return;
						}
						dragging = target;
						if (target.kind === 'stop') editor.selectStop(target.index);
					},
					onPointerMove: (event) => {
						if (dragging === undefined) return;
						dragTo(dragging, event.world);
					},
					onPointerUp: () => {
						dragging = undefined;
					},
					onDeactivate: () => {
						dragging = undefined;
						editor.close();
					},
					onCancel: () => {
						if (!editor.isOpen) return false;
						editor.close();
						return true;
					}
				}),
			'gradient edit tool'
		);

		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'gradient-editor/handles',
					order: 50,
					track: () => {
						void editor.state.current;
						void editor.paint;
						void editor.state.selectedStop;
					},
					draw: (frame) => {
						const request = editor.state.current;
						const paint = editor.paint;
						if (request === null || paint === undefined) return;
						const space = spaceOf(ctx, request.nodeId);
						if (space === undefined) return;
						drawGradientHandles(frame, paint, space, editor.state.selectedStop);
					}
				}),
			'gradient handles overlay'
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'gradient-editor/popover',
					region: 'overlay',
					component: GradientEditorHost
				}),
			'gradient editor popover'
		);

		ctx.on('selection/change', () => editor.close());
		ctx.on('document/replace', () => editor.close());
	}
};
