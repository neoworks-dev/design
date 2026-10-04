// Copy properties / paste properties (Ctrl+Alt+C / Ctrl+Alt+V). The copied appearance is held by
// the plugin for the session (it is not document data); pasting is one undo step.

import type { Context } from '@neoworks/extension-system';
import { applyEdit, contributeCommand } from '../../lib/editing/contribute';
import {
	copyProperties,
	planPasteProperties,
	type CopiedProperties
} from '../../lib/editing/properties';

const MENU = 'context/copy-as';

export function contributeProperties(ctx: Context): void {
	let copied: CopiedProperties | null = null;
	contributeCommand(ctx, {
		id: 'clipboard.copy-properties',
		title: 'Copy properties',
		when: 'hasSelection',
		run: () => {
			const properties = copyProperties(ctx.document.reader, ctx.selection.ids);
			if (properties !== null) copied = properties;
		},
		keys: ['Mod+Alt+C'],
		scope: 'canvas',
		menus: [{ menu: MENU, group: '2_properties', order: 0 }]
	});
	contributeCommand(ctx, {
		id: 'clipboard.paste-properties',
		title: 'Paste properties',
		when: 'hasSelection',
		run: () => {
			if (copied === null) return;
			const changes = planPasteProperties(ctx.document.reader, ctx.selection.ids, copied);
			applyEdit(ctx, changes, 'Paste properties');
		},
		keys: ['Mod+Alt+V'],
		scope: 'canvas',
		menus: [{ menu: MENU, group: '2_properties', order: 1 }]
	});
}
