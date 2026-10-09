// Shared plumbing of the editing plugins: contribute one command with its key bindings and menu
// entries as labelled effects, and apply planned changes through `document.apply`.
// Always call these with the plugin's own `ctx`, never an outer one.

import type { Context } from '@neoworks/extension-system';
import type { Change, Rect } from '../document';
import type { KeyScope } from '../registries/keymap.svelte';
import { PASTE_FIT } from '../viewport/camera';
import { planViewAdjustment, type PanMode, type ZoomRule } from './pasteView';

export interface MenuPlacement {
	/** Menu path, for example `context/canvas`. */
	menu: string;
	group: string;
	order?: number;
	/**
	 * Run the command with the popup's target as arguments (for example the cursor position)
	 * instead of an empty object.
	 */
	passTarget?: boolean;
}

export interface EditingCommand {
	id: string;
	title: string;
	/** Context-key expression gating the command, its bindings and its menu items. */
	when?: string;
	/** May return a promise (a command that restarts its plugin): the caller awaits it. */
	run: (args?: unknown) => unknown;
	/** Written chords (`Mod+G`). */
	keys?: string[];
	scope?: KeyScope;
	/** Key repeat fires the command again (nudging). */
	repeat?: boolean;
	menus?: MenuPlacement[];
}

/** Menu items run commands with `{}` unless they ask for the popup's target. */
function menuArguments(placement: MenuPlacement): unknown {
	if (placement.passTarget === true) return undefined;
	return {};
}

export function contributeCommand(ctx: Context, command: EditingCommand): void {
	ctx.effect(
		() =>
			ctx.commands.register({
				id: command.id,
				title: command.title,
				when: command.when,
				run: async (args) => {
					await command.run(args);
				}
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
						args: menuArguments(placement)
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

/**
 * Pans or zooms the view so freshly pasted or duplicated `content` is on screen, the way Figma
 * does after those actions. Does nothing without a canvas.
 */
export function followContent(
	ctx: Context,
	content: Rect,
	rule: ZoomRule,
	panMode: PanMode = 'overlap'
): void {
	const size = ctx.viewport.size;
	if (size.width <= 0 || size.height <= 0) return;
	const adjustment = planViewAdjustment(content, ctx.viewport.visibleRect(), rule, panMode);
	if (adjustment.kind === 'zoom-to-selection') {
		ctx.viewport.zoomToRect(content, PASTE_FIT);
		return;
	}
	if (adjustment.kind !== 'pan') return;
	const scale = ctx.viewport.zoom;
	ctx.viewport.panBy(-adjustment.shift.x * scale, -adjustment.shift.y * scale);
}

export function objectArguments(args: unknown): Record<string, unknown> {
	if (typeof args === 'object' && args !== null) return args as Record<string, unknown>;
	return {};
}
