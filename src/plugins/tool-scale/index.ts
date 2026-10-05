import type { Context } from '@neoworks/extension-system';
import ArrowsOutSimpleIcon from 'phosphor-svelte/lib/ArrowsOutSimpleIcon';
import { watchGestureKeys } from '../../lib/selecting/gestureKeys';
import { pickAt } from '../../lib/selecting/pick';
import { ResizeFeedbackState } from '../../lib/selecting/resizeFeedback.svelte';
import { ResizeGesture } from '../../lib/selecting/resizeGesture';
import { ScaleSession } from '../../lib/selecting/scaleSession';
import TransformHandles from '../../lib/selecting/TransformHandles.svelte';
import type { ToolPointerEvent } from '../../lib/tools/protocol';

const PRIMARY_BUTTON = 0;

// The Scale tool (K): the transform handles, but dragging scales the selection proportionally and
// everything inside it (text size, stroke weight, effects, radii, auto layout spacing), ignoring
// constraints and layout. The handle UI is the one of `transform-handles` (same component, bound
// to this tool); the maths is `scaleEdits` in lib/document/scale.ts, planned by `ScaleSession`.
// Clicking an object selects it, so the tool works without going through Move first.
export default {
	name: 'tool-scale',
	inject: [
		'tools',
		'document',
		'selection',
		'history',
		'snapping',
		'viewport',
		'hitTest',
		'regions'
	],
	apply(ctx: Context): void {
		const feedback = new ResizeFeedbackState();
		const gesture = new ResizeGesture(ctx, feedback, {
			label: 'Scale',
			createSession: (reader, ids) => new ScaleSession(reader, ids)
		});

		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'scale',
					title: 'Scale',
					icon: ArrowsOutSimpleIcon,
					shortcut: 'K',
					group: 'move',
					order: 0.1,
					cursor: 'default',
					onPointerDown(event: ToolPointerEvent): void {
						if (event.button !== PRIMARY_BUTTON) return;
						const hitId = pickAt(ctx, event.world, event);
						if (hitId === undefined) {
							ctx.selection.clear();
							return;
						}
						ctx.selection.select([hitId]);
					}
				}),
			'scale tool'
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'tool-scale/handles',
					region: 'canvas-overlay',
					component: TransformHandles,
					props: { feedback, gesture, toolId: 'scale' }
				}),
			'scale handles overlay'
		);

		ctx.effect(() => watchGestureKeys([gesture]), 'scale key handling');
	}
};
