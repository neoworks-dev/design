// Shared plumbing of the editing plugins: contribute one command with its key bindings and menu
// entries as labelled effects, and apply planned changes through `document.apply`.
// Always call these with the plugin's own `ctx`, never an outer one.

import type { Context } from '@neoworks/extension-system';
import type { Change } from '../document';
import type { KeyScope } from '../registries/keymap.svelte';

export interface MenuPlacement {
	/** Menu path, for example `context/canvas`. */
	menu: string;
	group: string;
	order?: number;
}

export interface EditingCommand {
	id: string;
	title: string;
	/** Context-key expression gating the command, its bindings and its menu items. */
	when?: string;
	run: (args?: unknown) => void;
	/** Written chords (`Mod+G`). */
	keys?: string[];
	scope?: KeyScope;
	/** Key repeat fires the command again (nudging). */
	repeat?: boolean;
	menus?: MenuPlacement[];
}

export function contributeCommand(ctx: Context, command: EditingCommand): void {
	ctx.effect(
		() =>
			ctx.commands.register({
				id: command.id,
				title: command.title,
				when: command.when,
				run: command.run
			}),
		`command ${command.id}`
	);
	for (const key of command.keys ?? []) {
		ctx.effect(
			() =>
				ctx.keymap.register({
					key,
					command: command.id,
					scope: command.scope ?? 'global',
					when: command.when,
					repeat: command.repeat
				}),
			`keymap ${command.id} ${key}`
		);
	}
	for (const placement of command.menus ?? []) {
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: placement.menu,
					item: {
						id: command.id,
						command: command.id,
						title: command.title,
						group: placement.group,
						order: placement.order,
						when: command.when,
						args: {}
					}
				}),
			`menu ${placement.menu} ${command.id}`
		);
	}
}

/** One undo step for `changes`; nothing is applied (and no history entry made) when empty. */
export function applyEdit(
	ctx: Context,
	changes: Change[],
	label: string,
	mergeKey?: string
): boolean {
	if (changes.length === 0) return false;
	ctx.document.apply(changes, { origin: 'user', label, mergeKey });
	return true;
}

export function objectArguments(args: unknown): Record<string, unknown> {
	if (typeof args === 'object' && args !== null) return args as Record<string, unknown>;
	return {};
}
