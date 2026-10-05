import type { Context } from '@neoworks/extension-system';
import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircleIcon';
import { drawPins, type PinPaint } from '../../lib/comments/draw';
import { PinClaimant } from '../../lib/comments/pinClaimant';
import { contributeCommand } from '../../lib/editing/contribute';
import { CommentsService, PIN_RADIUS } from '../../lib/services/comments';
import { CommentsState } from '../../lib/services/commentsState.svelte';
import CommentEditor from './CommentEditor.svelte';
import CommentsPanel from './CommentsPanel.svelte';

function pinsToPaint(
	ctx: Context,
	comments: CommentsService,
	project: (p: { x: number; y: number }) => { x: number; y: number }
): PinPaint[] {
	const editor = comments.editor;
	const pins: PinPaint[] = comments.onCurrentPage().map((comment) => ({
		tip: project(comments.positionOf(comment)),
		number: comment.number,
		resolved: comment.resolved,
		selected: editor !== null && editor.kind === 'comment' && editor.id === comment.id,
		draft: false
	}));
	const draft = comments.draft;
	if (draft !== null && draft.pageId === ctx.document.currentPageId) {
		pins.push({
			tip: project(draft.point),
			number: null,
			resolved: false,
			selected: false,
			draft: true
		});
	}
	return pins;
}

// Comments (#68): local notes pinned to canvas positions or nodes. Tool C drops a pin and opens a
// note; pins are drawn on the overlay, follow the node they were dropped on, and a press on one
// opens it with any tool. The Comments tab in the right sidebar lists them across pages with
// search and an open/resolved filter, and jumps to a pin. Shift+C shows or hides the pins.
// The notes are document data (page `pluginData`, see lib/comments/model.ts), so creating,
// editing, resolving and deleting are undoable like any other change.
export default {
	name: 'comments',
	inject: [
		'tools',
		'panels',
		'document',
		'overlay',
		'canvasInput',
		'viewport',
		'hitTest',
		'regions',
		'commands',
		'keymap',
		'menus'
	],
	apply(ctx: Context): void {
		const comments = new CommentsService(
			ctx,
			ctx.document,
			ctx.viewport,
			ctx.hitTest,
			new CommentsState()
		);

		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'comment',
					title: 'Comment',
					icon: ChatCircleIcon,
					shortcut: 'C',
					group: 'view',
					order: 21,
					cursor: 'crosshair',
					onActivate: () => comments.setVisible(true),
					onDeactivate: () => comments.cancelDraft(),
					onPointerDown: (event) => {
						if (event.button !== 0) return;
						comments.beginDraft(event.world);
					},
					onCancel: () => {
						if (comments.editor === null) return false;
						comments.closeEditor();
						return true;
					}
				}),
			'comment tool'
		);

		ctx.effect(
			() =>
				ctx.panels.registerTab({
					id: 'comments',
					side: 'right',
					title: 'Comments',
					icon: ChatCircleIcon,
					order: 3,
					component: CommentsPanel
				}),
			'comments tab'
		);

		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'comments/pins',
					order: 45,
					track: () => {
						void comments.visible;
						void comments.onCurrentPage();
						void comments.draft;
						void comments.editor;
					},
					draw: (frame) => {
						if (!comments.visible) return;
						drawPins(frame, pinsToPaint(ctx, comments, frame.worldToScreen), PIN_RADIUS);
					}
				}),
			'comments pins overlay'
		);
		ctx.effect(() => ctx.canvasInput.claim(new PinClaimant(ctx)), 'comments pin claim');

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'comments/editor',
					region: 'canvas-overlay',
					component: CommentEditor
				}),
			'comments editor'
		);

		// The editor belongs to the open document: a replaced document or another page closes it.
		ctx.on('document/replace', () => comments.closeEditor());
		ctx.on('document/currentpagechange', () => comments.closeEditor());
		ctx.effect(() => () => comments.closeEditor(), 'comments/close on unload');

		contributeCommand(ctx, {
			id: 'comments.toggle-visibility',
			title: 'Show/hide comments',
			keys: ['Shift+C'],
			run: () => comments.toggleVisible(),
			menus: [{ menu: 'app/view', group: '7_comments', order: 1 }]
		});
	}
};
