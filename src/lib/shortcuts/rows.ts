// What the shortcut panel lists: one row per command with its active bindings, grouped by the
// category the command id starts with. Pure functions over the keymap's reactive lists so the rules
// are testable without the UI.

import { formatChord, type Platform } from '../registries/chord';
import type { KeyBinding, KeyOverrideSummary, KeyScope } from '../registries/keymap.svelte';

export interface ShortcutBinding {
	scope: KeyScope;
	/** Canonical chord, also what `rebind` accepts. */
	chord: string;
	display: string;
	/** Who defined it: `Custom` (the user), `<preset> preset`, or the plugin id. */
	source: string;
	custom: boolean;
}

export interface ShortcutRow {
	commandId: string;
	title: string;
	category: string;
	bindings: ShortcutBinding[];
	/** The user changed or removed a binding of this command: it can be reset. */
	modified: boolean;
}

export interface CommandSummary {
	id: string;
	title: string;
}

export function categoryOf(commandId: string): string {
	const prefix = commandId.split('.')[0];
	const spaced = prefix.replace(/[-_]+/g, ' ');
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function sourceLabel(source: string): string {
	if (source === 'user') return 'Custom';
	if (source.startsWith('preset:')) return `${source.slice('preset:'.length)} preset`;
	if (source === '') return 'Default';
	return source;
}

function bindingOf(binding: KeyBinding, platform: Platform): ShortcutBinding {
	return {
		scope: binding.scope,
		chord: binding.chord,
		display: formatChord(binding.chord, platform),
		source: sourceLabel(binding.source),
		custom: binding.source === 'user'
	};
}

/** One row per command, in command order, with the bindings that are active now. */
export function buildRows(
	commands: readonly CommandSummary[],
	bindings: readonly KeyBinding[],
	overrides: readonly KeyOverrideSummary[],
	platform: Platform
): ShortcutRow[] {
	const modified = new Set(overrides.map((override) => override.command));
	return commands.map((command) => ({
		commandId: command.id,
		title: command.title,
		category: categoryOf(command.id),
		bindings: bindings
			.filter((binding) => binding.command === command.id && binding.chord !== '')
			.map((binding) => bindingOf(binding, platform)),
		modified: modified.has(command.id)
	}));
}

function normalise(text: string): string {
	return text.toLowerCase().replace(/\s+/g, '');
}

/** Whether the row's title, id or any of its chords contains `query` (case and spaces ignored). */
export function rowMatches(row: ShortcutRow, query: string): boolean {
	const needle = normalise(query);
	if (needle === '') return true;
	if (normalise(row.title).includes(needle)) return true;
	if (normalise(row.commandId).includes(needle)) return true;
	return row.bindings.some(
		(binding) => normalise(binding.display).includes(needle) || binding.chord.includes(needle)
	);
}

export interface ShortcutGroup {
	category: string;
	rows: ShortcutRow[];
}

/** Rows grouped by category, categories in the order they first appear. */
export function groupRows(rows: readonly ShortcutRow[]): ShortcutGroup[] {
	const groups: ShortcutGroup[] = [];
	for (const row of rows) {
		const group = groups.find((candidate) => candidate.category === row.category);
		if (group) group.rows.push(row);
		else groups.push({ category: row.category, rows: [row] });
	}
	return groups;
}
