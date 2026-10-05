import type { Context } from '@neoworks/extension-system';
import { objectArguments } from '../../lib/editing/contribute';
import { PagesState } from '../../lib/pages/pagesState.svelte';
import { PagesPanelService } from '../../lib/services/pagesPanel';
import AddPageButton from './AddPageButton.svelte';
import PagesSection from './PagesSection.svelte';

const PAGE_MENU = 'context/page';

function pageIdOf(ctx: Context, args: unknown): string {
	const pageId = objectArguments(args).pageId;
	if (typeof pageId === 'string') return pageId;
	return ctx.document.currentPageId;
}

function publishPageCount(ctx: Context): void {
	let dispose: (() => void) | undefined;
	const publish = (): void => {
		dispose?.();
		dispose = ctx.contextKeys.set('multiplePages', ctx.document.pages().length > 1);
	};
	ctx.effect(() => {
		publish();
		return () => dispose?.();
	}, 'context key multiplePages');
	// Each publish replaces the key's entry, so an older disposer is a no-op (dispose by identity).
	ctx.on('document/change', publish);
	ctx.on('document/replace', publish);
}

// The pages panel: the list of pages above the layers in the left sidebar's File tab. Add with
// "+", click to switch, double-click to rename, drag to reorder, right click for rename,
// duplicate and delete (the `page` context menu). Edits are the document service's page methods,
// so each is one undo step; switching pages is view state.
export default {
	name: 'pages-panel',
	inject: ['panels', 'document', 'commands', 'menus', 'contextKeys'],
	apply(ctx: Context): void {
		new PagesPanelService(ctx, ctx.document, new PagesState());

		ctx.effect(
			() =>
				ctx.panels.registerSection({
					tab: 'file',
					id: 'pages',
					title: 'Pages',
					order: 0,
					component: PagesSection,
					actions: AddPageButton
				}),
			'pages section'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'pages.rename',
					title: 'Rename',
					run: (args) => ctx.pagesPanel.startRename(pageIdOf(ctx, args))
				}),
			'command pages.rename'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'pages.delete',
					title: 'Delete',
					when: 'multiplePages',
					run: (args) => ctx.document.deletePage(pageIdOf(ctx, args))
				}),
			'command pages.delete'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'pages.duplicate',
					title: 'Duplicate',
					run: (args) => void ctx.document.duplicatePage(pageIdOf(ctx, args))
				}),
			'command pages.duplicate'
		);
		publishPageCount(ctx);

		const items = [
			{ id: 'rename', command: 'pages.rename', group: '1_edit' },
			{ id: 'duplicate', command: 'pages.duplicate', group: '1_edit' },
			{ id: 'delete', command: 'pages.delete', group: '2_delete' }
		];
		for (const item of items) {
			ctx.effect(
				() => ctx.menus.register({ menu: PAGE_MENU, item }),
				`menu ${PAGE_MENU} ${item.id}`
			);
		}
	}
};
