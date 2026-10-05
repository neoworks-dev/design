// The `shortcutsPanel` service: the shortcut browser and editor (#133) on top of `keymap`,
// `commands` and `shortcuts`. It lists every command with its active bindings, records a new chord
// from the next key press, and rebinds through `shortcuts.rebind`, so a change applies at once and
// is persisted like any other rebinding.

import { Service, type Context } from '@neoworks/extension-system';
import {
	ChordError,
	chordFromEvent,
	formatChord,
	parseChord,
	type KeyEventLike
} from '../registries/chord';
import type { CommandsService } from '../registries/commands.svelte';
import type { KeymapService, KeyScope } from '../registries/keymap.svelte';
import {
	buildRows,
	groupRows,
	rowMatches,
	type ShortcutGroup,
	type ShortcutRow
} from '../shortcuts/rows';
import type { ShortcutsPanelState } from './shortcutsPanelState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		shortcutsPanel: ShortcutsPanelService;
	}
}

/** The part of the `shortcuts` service the panel uses (the library may not import plugins). */
export interface PanelShortcuts {
	presets(): { id: string; title: string }[];
	readonly preset: string;
	setPreset(id: string): void;
	rebind(
		command: string,
		key: string | null,
		scope: KeyScope,
		options: { onConflict: 'refuse' | 'replace' }
	): { applied: boolean; conflicts: { command: string }[] };
	reset(command: string, scope: KeyScope): void;
	resetAll(): void;
}

const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'];
const DEFAULT_SCOPE: KeyScope = 'global';

export class ShortcutsPanelService extends Service {
	constructor(
		ctx: Context,
		private readonly keymap: KeymapService,
		private readonly commands: CommandsService,
		private readonly shortcuts: PanelShortcuts,
		private readonly state: ShortcutsPanelState
	) {
		super(ctx, 'shortcutsPanel');
	}

	// ---------- reads (reactive) ----------

	get isOpen(): boolean {
		return this.state.isOpen;
	}

	get query(): string {
		return this.state.query;
	}

	get recording(): { commandId: string; scope: KeyScope } | null {
		return this.state.recording;
	}

	get conflict(): ShortcutsPanelState['conflict'] {
		return this.state.conflict;
	}

	get presets(): { id: string; title: string }[] {
		return this.shortcuts.presets();
	}

	get preset(): string {
		return this.shortcuts.preset;
	}

	/** Every command with its active bindings, before the search. */
	allRows(): ShortcutRow[] {
		return buildRows(
			this.commands.list(),
			this.keymap.bindings(),
			this.keymap.listOverrides(),
			this.keymap.platform
		);
	}

	/** The rows matching the search, grouped by category. */
	groups(): ShortcutGroup[] {
		const query = this.state.query;
		return groupRows(this.allRows().filter((row) => rowMatches(row, query)));
	}

	/** Whether the user has any custom binding to reset. */
	get hasOverrides(): boolean {
		return this.keymap.listOverrides().length > 0;
	}

	// ---------- opening ----------

	open(): void {
		this.state.isOpen = true;
	}

	close(): void {
		this.state.isOpen = false;
		this.state.query = '';
		this.state.recording = null;
		this.state.conflict = null;
	}

	toggle(): void {
		if (this.state.isOpen) this.close();
		else this.open();
	}

	setQuery(query: string): void {
		this.state.query = query;
	}

	setPreset(id: string): void {
		this.shortcuts.setPreset(id);
	}

	// ---------- recording a chord ----------

	/** The next key press becomes `commandId`'s binding in `scope` (global unless it has one). */
	startRecording(commandId: string, scope: KeyScope = DEFAULT_SCOPE): void {
		this.state.conflict = null;
		this.state.recording = { commandId, scope };
	}

	cancelRecording(): void {
		this.state.recording = null;
		this.state.conflict = null;
	}

	/**
	 * A key press while recording. Escape cancels, a lone modifier is ignored (the chord is not
	 * finished), anything else is bound. Returns whether the event was consumed.
	 */
	recordEvent(event: KeyEventLike): boolean {
		const recording = this.state.recording;
		if (recording === null) return false;
		if (MODIFIER_KEYS.includes(event.key)) return true;
		if (event.key === 'Escape') {
			this.cancelRecording();
			return true;
		}
		try {
			this.bind(recording.commandId, chordFromEvent(event), recording.scope);
		} catch (error) {
			// a key the keymap has no name for (dead keys): keep waiting for another one
			if (!(error instanceof ChordError)) throw error;
			this.state.recording = recording;
		}
		return true;
	}

	/** Bind `key` (a written or canonical chord); on a clash the user is asked to replace. */
	bind(commandId: string, key: string, scope: KeyScope): void {
		const result = this.shortcuts.rebind(commandId, key, scope, { onConflict: 'refuse' });
		if (result.applied) {
			this.state.recording = null;
			this.state.conflict = null;
			return;
		}
		this.state.recording = null;
		this.state.conflict = {
			commandId,
			scope,
			key,
			display: this.displayOf(key),
			holders: result.conflicts.map((binding) => this.titleOf(binding.command))
		};
	}

	/** Take the chord from the commands that hold it. */
	confirmReplace(): void {
		const pending = this.state.conflict;
		if (pending === null) return;
		this.shortcuts.rebind(pending.commandId, pending.key, pending.scope, { onConflict: 'replace' });
		this.state.conflict = null;
	}

	/** Leave `commandId` without a binding in `scope`. */
	unbind(commandId: string, scope: KeyScope): void {
		this.shortcuts.rebind(commandId, null, scope, { onConflict: 'refuse' });
	}

	/** Put every binding of one command back to the preset or default. */
	reset(commandId: string): void {
		for (const override of this.keymap.listOverrides()) {
			if (override.command === commandId) this.shortcuts.reset(commandId, override.scope);
		}
	}

	resetAll(): void {
		this.shortcuts.resetAll();
	}

	snapshotState(): Record<string, unknown> {
		return { open: this.state.isOpen, recording: this.state.recording !== null };
	}

	// ---------- internals ----------

	private titleOf(commandId: string): string {
		const command = this.commands.get(commandId);
		if (command === undefined) return commandId;
		return command.title;
	}

	private displayOf(key: string): string {
		const platform = this.keymap.platform;
		return formatChord(parseChord(key, platform), platform);
	}
}
