import type { Context } from '@neoworks/extension-system';
import CodeIcon from 'phosphor-svelte/lib/CodeIcon';
import CursorClickIcon from 'phosphor-svelte/lib/CursorClickIcon';
import { DEFAULT_TOOL_ID } from '../../lib/registries/tools.svelte';
import type { PanelMode } from '../../lib/registries/panels.svelte';

const MODES: { id: PanelMode; title: string; icon: typeof CodeIcon; accent?: 'green' }[] = [
	{ id: 'design', title: 'Design', icon: CursorClickIcon },
	{ id: 'dev', title: 'Dev Mode', icon: CodeIcon, accent: 'green' }
];

// The Design and Dev buttons of the toolbar's mode group, switching `panels.mode`. Draw and
// Prototype are Figma modes this app does not have (Prototype is a tab of the right sidebar).
export default {
	name: 'toolbar-modes',
	inject: ['toolbar', 'panels', 'commands', 'tools'],
	apply(ctx: Context): void {
		MODES.forEach((mode, position) => {
			const command = `toolbar-modes.set-${mode.id}`;
			ctx.effect(
				() =>
					ctx.commands.register({
						id: command,
						title: `Switch to ${mode.title}`,
						run: () => {
							ctx.panels.setMode(mode.id);
							if (ctx.tools.get(DEFAULT_TOOL_ID) !== undefined) ctx.tools.activate(DEFAULT_TOOL_ID);
						}
					}),
				`command ${command}`
			);
			ctx.effect(
				() =>
					ctx.toolbar.registerMode({
						id: mode.id,
						title: mode.title,
						icon: mode.icon,
						command,
						active: `mode == '${mode.id}'`,
						accent: mode.accent,
						order: position
					}),
				`toolbar mode ${mode.id}`
			);
		});
	}
};
