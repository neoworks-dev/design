import type { Context } from '@neoworks/extension-system';
import { contributeCommand } from '../../lib/editing/contribute';
import {
	levelContainer,
	planInvert,
	planSelectAll,
	planSelectMatching
} from '../../lib/selecting/levelSelection';

function enter(ctx: Context): void {
	const primaryId = ctx.selection.primaryId;
	if (primaryId === null) return;
	const type = ctx.document.require(primaryId).type;
	if (type === 'TEXT') ctx.emit('canvas/edit-request', primaryId, 'text');
	else if (type === 'VECTOR') ctx.emit('canvas/edit-request', primaryId, 'vector');
	else ctx.selection.selectChildren();
}

function sibling(ctx: Context, direction: 'next' | 'previous'): void {
	if (ctx.selection.count !== 1) return;
	ctx.selection.selectSibling(direction);
}

/** Esc on the default tool: abort a gesture in progress, otherwise deselect. */
function escape(ctx: Context): void {
	if (ctx.tools.cancel()) return;
	ctx.selection.clear();
}

function currentLevel(ctx: Context): string {
	return levelContainer(
		ctx.document.reader,
		ctx.selection.ids,
		ctx.selection.scopeId,
		ctx.document.currentPageId
	);
}

function selectAll(ctx: Context): void {
	ctx.selection.select(planSelectAll(ctx.document.reader, currentLevel(ctx)), 'replace');
}

function invert(ctx: Context): void {
	const ids = planInvert(ctx.document.reader, currentLevel(ctx), ctx.selection.ids);
	ctx.selection.select(ids, 'replace');
}

function selectMatching(ctx: Context): void {
	const primaryId = ctx.selection.primaryId;
	if (primaryId === null) return;
	const ids = planSelectMatching(ctx.document.reader, ctx.document.currentPageId, primaryId);
	ctx.selection.select(ids, 'replace');
}

// The selection commands of docs/research/interactions.md section 3. Show/hide, lock and rename
// (Ctrl+Shift+H, Ctrl+Shift+L, Ctrl+R) already belong to `node-commands`.
export default {
	name: 'selection-commands',
	inject: ['selection', 'document', 'commands', 'keymap', 'tools'],
	apply(ctx: Context): void {
		contributeCommand(ctx, {
			id: 'selection.enter',
			title: 'Select children or edit',
			when: 'hasSelection',
			run: () => enter(ctx),
			keys: ['Enter']
		});
		contributeCommand(ctx, {
			id: 'selection.select-parent',
			title: 'Select parent',
			when: 'hasSelection',
			run: () => ctx.selection.selectParent(),
			keys: ['Shift+Enter', '\\']
		});
		contributeCommand(ctx, {
			id: 'selection.next-sibling',
			title: 'Select next sibling',
			when: 'hasSelection',
			run: () => sibling(ctx, 'next'),
			keys: ['Tab']
		});
		contributeCommand(ctx, {
			id: 'selection.previous-sibling',
			title: 'Select previous sibling',
			when: 'hasSelection',
			run: () => sibling(ctx, 'previous'),
			keys: ['Shift+Tab']
		});
		contributeCommand(ctx, {
			id: 'selection.deselect',
			title: 'Deselect',
			when: 'toolIsDefault',
			run: () => escape(ctx),
			keys: ['Escape']
		});
		contributeCommand(ctx, {
			id: 'selection.select-all',
			title: 'Select all',
			run: () => selectAll(ctx),
			keys: ['Mod+A']
		});
		contributeCommand(ctx, {
			id: 'selection.invert',
			title: 'Invert selection',
			run: () => invert(ctx),
			keys: ['Mod+Shift+A']
		});
		contributeCommand(ctx, {
			id: 'selection.select-matching',
			title: 'Select matching layers',
			when: 'hasSelection',
			run: () => selectMatching(ctx),
			keys: ['Mod+Alt+A']
		});
	}
};
