import type { Context } from '@neoworks/extension-system';
import { z } from 'zod';
import type { Change, NodeId } from '../../lib/document';
import { applyEdit, contributeCommand } from '../../lib/editing/contribute';
import { isPositioned, topLevelIds } from '../../lib/editing/selectionOps';
import { planNudge } from '../../lib/editing/nudge';
import { planResizeTo } from '../../lib/inspector-inputs/geometry';

declare module '@neoworks/extension-system' {
	interface Events {
		/** Dispatch mode: emit. Nodes did not move because auto layout owns their position. */
		'nudge/blocked'(ids: NodeId[]): void;
	}
}

// The plugin's settings (shown in Settings, stored by main).
const nudgeConfigSchema = z
	.object({
		step: z.number().positive().default(1).describe('Pixels per arrow key press.'),
		bigStep: z.number().positive().default(10).describe('Pixels per Shift+arrow key press.')
	})
	.prefault({});
export type NudgeConfig = z.infer<typeof nudgeConfigSchema>;

interface Direction {
	name: string;
	key: string;
	x: number;
	y: number;
}

const DIRECTIONS: Direction[] = [
	{ name: 'left', key: 'ArrowLeft', x: -1, y: 0 },
	{ name: 'right', key: 'ArrowRight', x: 1, y: 0 },
	{ name: 'up', key: 'ArrowUp', x: 0, y: -1 },
	{ name: 'down', key: 'ArrowDown', x: 0, y: 1 }
];

function stepOf(value: number | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	if (!Number.isFinite(value) || value <= 0) return fallback;
	return value;
}

// Nudges closer together than this are one undo step (Figma merges at 300 ms, not at 1000 ms).
const NUDGE_MERGE_WINDOW_MS = 700;

/** Merge key for the next nudge: rapid presses share one, a pause starts a new one. */
class NudgeBurst {
	private lastAt = Number.NEGATIVE_INFINITY;
	private burst = 0;

	nextKey(now: number): string {
		if (now - this.lastAt > NUDGE_MERGE_WINDOW_MS) this.burst += 1;
		this.lastAt = now;
		return `nudge:${this.burst}`;
	}
}

function resizeBy(ctx: Context, burst: NudgeBurst, deltaX: number, deltaY: number): void {
	const reader = ctx.document.reader;
	const changes: Change[] = [];
	for (const id of topLevelIds(reader, ctx.selection.ids)) {
		const node = reader.requireNode(id);
		if (!isPositioned(node) || node.locked) continue;
		const size: { width?: number; height?: number } = {};
		if (deltaX !== 0) size.width = node.width + deltaX;
		if (deltaY !== 0) size.height = node.height + deltaY;
		changes.push(...planResizeTo(reader, id, size));
	}
	applyEdit(ctx, changes, 'Resize', burst.nextKey(Date.now()).replace('nudge', 'nudge-resize'));
}

function nudge(ctx: Context, burst: NudgeBurst, deltaX: number, deltaY: number): void {
	if (ctx.selection.count === 0) return;
	const roundToPixel = ctx.waterfall('nudge/pixel-snap', false, () => false);
	const plan = planNudge(ctx.document.reader, ctx.selection.ids, deltaX, deltaY, roundToPixel);
	if (plan.blockedByAutoLayout.length > 0) ctx.emit('nudge/blocked', plan.blockedByAutoLayout);
	// One merge key: rapid presses (key repeat included) fold into a single undo step.
	applyEdit(ctx, plan.changes, 'Nudge', burst.nextKey(Date.now()));
}

// Arrow keys move the selection by `step` px, Shift+arrow by `bigStep`. Moves are in screen axes
// and skip auto layout children. With an empty selection the viewport's own arrow bindings pan.
export default {
	name: 'nudge',
	inject: ['document', 'selection', 'commands', 'keymap'],
	Config: nudgeConfigSchema,
	apply(ctx: Context, config: NudgeConfig): void {
		const step = stepOf(config.step, 1);
		const bigStep = stepOf(config.bigStep, 10);
		const burst = new NudgeBurst();
		for (const direction of DIRECTIONS) {
			const variants = [
				{ id: '', title: '', keys: direction.key, amount: step, resize: false },
				{
					id: '-big',
					title: ' by a large step',
					keys: `Shift+${direction.key}`,
					amount: bigStep,
					resize: false
				},
				{
					id: '-fine',
					title: ' by one pixel',
					keys: `Alt+${direction.key}`,
					amount: 1,
					resize: false
				},
				{
					id: '-resize',
					title: ' (resize by one pixel)',
					keys: `Mod+${direction.key}`,
					amount: 1,
					resize: true
				},
				{
					id: '-resize-big',
					title: ' (resize by a large step)',
					keys: `Mod+Shift+${direction.key}`,
					amount: bigStep,
					resize: true
				}
			];
			for (const variant of variants) {
				const run = (): void => {
					if (variant.resize)
						resizeBy(ctx, burst, direction.x * variant.amount, direction.y * variant.amount);
					else nudge(ctx, burst, direction.x * variant.amount, direction.y * variant.amount);
				};
				contributeCommand(ctx, {
					id: `nudge.${direction.name}${variant.id}`,
					title: `Nudge ${direction.name}${variant.title}`,
					run,
					keys: [variant.keys],
					when: 'hasSelection',
					repeat: true
				});
			}
		}
	}
};
