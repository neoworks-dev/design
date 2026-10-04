// Page lifecycle commands. Every one goes through `document.apply` (via the page methods), so
// each is one undo step. Arguments are optional where a sensible default exists (the current
// page), and validated because commands can be invoked from the palette, keymap, plugins and AI.

import type { Context } from '@neoworks/extension-system';
import type { DocumentService } from '../../lib/services/document';

function argumentsObject(args: unknown): Record<string, unknown> {
	if (typeof args === 'object' && args !== null) return args as Record<string, unknown>;
	return {};
}

function pageIdArgument(document: DocumentService, args: unknown): string {
	const candidate = argumentsObject(args).pageId;
	if (typeof candidate === 'string') return candidate;
	return document.currentPageId;
}

function stringArgument(args: unknown, key: string): string {
	const value = argumentsObject(args)[key];
	if (typeof value === 'string') return value;
	throw new TypeError(`expected a string argument "${key}"`);
}

function numberArgument(args: unknown, key: string): number {
	const value = argumentsObject(args)[key];
	if (typeof value === 'number') return value;
	throw new TypeError(`expected a number argument "${key}"`);
}

export function registerPageCommands(ctx: Context, document: DocumentService): void {
	ctx.effect(
		() =>
			ctx.commands.register({
				id: 'page.create',
				title: 'New page',
				run: (args) => {
					const name = argumentsObject(args).name;
					document.createPage(typeof name === 'string' ? name : undefined);
				}
			}),
		'command page.create'
	);
	ctx.effect(
		() =>
			ctx.commands.register({
				id: 'page.rename',
				title: 'Rename page',
				run: (args) =>
					document.renamePage(pageIdArgument(document, args), stringArgument(args, 'name'))
			}),
		'command page.rename'
	);
	ctx.effect(
		() =>
			ctx.commands.register({
				id: 'page.duplicate',
				title: 'Duplicate page',
				run: (args) => {
					document.duplicatePage(pageIdArgument(document, args));
				}
			}),
		'command page.duplicate'
	);
	ctx.effect(
		() =>
			ctx.commands.register({
				id: 'page.delete',
				title: 'Delete page',
				run: (args) => document.deletePage(pageIdArgument(document, args))
			}),
		'command page.delete'
	);
	ctx.effect(
		() =>
			ctx.commands.register({
				id: 'page.reorder',
				title: 'Move page',
				run: (args) =>
					document.reorderPage(pageIdArgument(document, args), numberArgument(args, 'position'))
			}),
		'command page.reorder'
	);
	ctx.effect(
		() =>
			ctx.commands.register({
				id: 'page.switch',
				title: 'Go to page',
				run: (args) => document.setCurrentPage(stringArgument(args, 'pageId'))
			}),
		'command page.switch'
	);
}
