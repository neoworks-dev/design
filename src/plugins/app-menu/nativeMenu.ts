import type { NativeMenuItem } from '../../../electron/bridge';
import { toElectronAccelerator } from '../../lib/registries/chord';
import type { ResolvedMenuItem } from '../../lib/registries/menus.svelte';

/** First canonical chord bound to a command, if any. */
export type ChordLookup = (command: string) => string | undefined;

/**
 * The resolved menu bar as a native menu tree. Pure: the caller resolves the menus (reactively)
 * and provides the chord lookup, so a change of state or of a binding yields a new tree.
 */
export function toNativeItems(
	items: readonly ResolvedMenuItem[],
	chordOf: ChordLookup
): NativeMenuItem[] {
	return items.map((item) => toNativeItem(item, chordOf));
}

function toNativeItem(item: ResolvedMenuItem, chordOf: ChordLookup): NativeMenuItem {
	const native: NativeMenuItem = {
		label: item.title,
		enabled: item.enabled,
		checked: item.checked,
		separatorBefore: item.separatorBefore
	};
	if (item.submenu) native.submenu = toNativeItems(item.submenu, chordOf);
	if (item.command === undefined) return native;
	native.command = item.command;
	native.args = item.args;
	const chord = chordOf(item.command);
	if (chord !== undefined) native.accelerator = toElectronAccelerator(chord);
	return native;
}
