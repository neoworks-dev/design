// What the Move tool drives while the pointer drags a selection. The default is `MoveSession`
// (free movement and reparenting). A plugin can take over a drag it understands better by
// answering the `move/begin` event with its own `MoveDrag`; auto layout does this to reorder
// children instead of moving them.

import type { NodeId } from '../document';
import type { Modifiers, Point } from '../tools/protocol';

export interface MoveDrag {
	update(world: Point, modifiers: Modifiers): void;
	/** Re-plan with new modifier state when no pointer move arrives (Shift pressed while still). */
	refresh(modifiers: Modifiers): void;
	/** Space pins the drag to the container it started in. */
	setPinned(pinned: boolean): void;
	/** The drop: closes the history group, one undo step. */
	commit(): void;
	/** Escape: no trace in the document. */
	cancel(): void;
}

export interface MoveBeginRequest {
	/** The selection, as the tool has it. */
	ids: readonly NodeId[];
	startWorld: Point;
	modifiers: Modifiers;
}
