import type { Context } from '@neoworks/extension-system';
import { VariablesUiService } from '../../lib/services/variablesUi';
import { VariablesUiState } from '../../lib/services/variablesUiState.svelte';
import ModeSection from './ModeSection.svelte';
import VariablesDialog from './VariablesDialog.svelte';

const MODE_HOLDERS = ['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];

// The UI of variables (#114): the modal (collections, modes as columns, rows grouped by slash
// path, aliases, scopes, code syntax), the `variables.open` command the Page section and the
// menus call, and the variable-mode switcher of a selected frame. Resolution and every write live
// in the core `variables` service (plugin `variables-core`); numeric fields bind through
// `BindVariable` and colours through the colour picker.
export default {
	name: 'variables-ui',
	inject: ['variables', 'commands', 'menus', 'regions', 'inspectors', 'selection', 'document'],
	apply(ctx: Context): void {
		const service = new VariablesUiService(ctx, new VariablesUiState());

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'variables.open',
					title: 'Open variables',
					run: () => service.open()
				}),
			'command variables.open'
		);
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'app/view',
					item: { id: 'variables', command: 'variables.open', group: '8_variables', order: 1 }
				}),
			'menu app/view variables'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'variables-ui/dialog',
					region: 'overlay',
					component: VariablesDialog
				}),
			'variables dialog'
		);
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'variable-mode',
					tab: 'design',
					title: 'Variable mode',
					order: 22,
					applies: (selection) => {
						if (selection.count !== 1 || !MODE_HOLDERS.includes(selection.kind)) return false;
						return ctx.variables.collections().some((collection) => collection.modes.length > 1);
					},
					component: ModeSection
				}),
			'variable mode section'
		);

		// An open modal must not outlive the plugin.
		ctx.effect(() => () => service.close(), 'variables-ui/close on unload');
	}
};
