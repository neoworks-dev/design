import type { Context } from '@neoworks/extension-system';
import type { NodeId } from '../../lib/document';
import { applyEdit, contributeCommand } from '../../lib/editing/contribute';
import { planNudge } from '../../lib/editing/nudge';

declare module '@neoworks/extension-system' {
	interface Events {
		/** Dispatch mode: emit. Nodes did not move because auto layout owns their position. */
		'nudge/blocked'(ids: NodeId[]): void;
	}
}

export interface NudgeConfig {
	/** Pixels per arrow press. */
	step?: number;
	/** Pixels per Shift+arrow press. */
	bigStep?: number;
}

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

function nudge(ctx: Context, deltaX: number, deltaY: number): void {
	if (ctx.selection.count === 0) return;
	const plan = planNudge(ctx.document.reader, ctx.selection.ids, deltaX, deltaY);
	if (plan.blockedByAutoLayout.length > 0) ctx.emit('nudge/blocked', plan.blockedByAutoLayout);
	// One merge key: rapid presses (key repeat included) fold into a single undo step.
	applyEdit(ctx, plan.changes, 'Nudge', 'nudge');
}

// Arrow keys move the selection by `step` px, Shift+arrow by `bigStep`. Moves are in screen axes
// and skip auto layout children. With an empty selection the viewport's own arrow bindings pan.
export default {
	name: 'nudge',
	inject: ['document', 'selection', 'commands', 'keymap'],
	apply(ctx: Context, config?: NudgeConfig): void {
		const step = stepOf(config?.step, 1);
		const bigStep = stepOf(config?.bigStep, 10);
		for (const direction of DIRECTIONS) {
			contributeCommand(ctx, {
				id: `nudge.${direction.name}`,
				title: `Nudge ${direction.name}`,
				run: () => nudge(ctx, direction.x * step, direction.y * step),
				keys: [direction.key],
				when: 'hasSelection',
				repeat: true
			});
			contributeCommand(ctx, {
				id: `nudge.${direction.name}-big`,
				title: `Nudge ${direction.name} by a large step`,
				run: () => nudge(ctx, direction.x * bigStep, direction.y * bigStep),
				keys: [`Shift+${direction.key}`],
				when: 'hasSelection',
				repeat: true
			});
		}
	}
};
