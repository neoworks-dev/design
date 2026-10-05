// Reactive holder behind the `comments` service (a Service may not hold runes).

import type { NodeId } from '../document/types';
import type { CommentFilter, Point } from '../comments/model';

/** A pin being placed: nothing is stored until the note is posted. */
export interface CommentDraft {
	pageId: NodeId;
	point: Point;
	anchorId: NodeId | null;
	anchorOrigin: Point | null;
}

/** Which note the editor next to the canvas shows. */
export type EditorTarget = { kind: 'draft' } | { kind: 'comment'; id: string };

export class CommentsState {
	/** Pins are drawn (Shift+C toggles; placing a comment shows them). */
	visible = $state.raw(true);
	draft = $state.raw<CommentDraft | null>(null);
	editor = $state.raw<EditorTarget | null>(null);
	query = $state.raw('');
	filter = $state.raw<CommentFilter>('all');
}
