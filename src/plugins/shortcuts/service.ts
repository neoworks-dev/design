import { Service, type Context } from '@neoworks/extension-system';
import type {
	KeyBinding,
	KeyConflict,
	KeyOverrideSummary,
	KeymapService,
	KeyScope
} from '../../lib/registries/keymap.svelte';

export interface RebindOptions {
	/**
	 * What to do when the chord is taken: `refuse` (default) changes nothing and reports the
	 * conflicts, `replace` unbinds the conflicting commands in that scope, `allow` binds anyway.
	 */
	onConflict?: 'refuse' | 'replace' | 'allow';
}

export interface RebindResult {
	applied: boolean;
	/** The bindings that held the chord before the rebind. */
	conflicts: KeyBinding[];
}

export interface PresetSummary {
	id: string;
	title: string;
}

interface ExportedOverrides {
	version: 1;
	preset: string;
	overrides: KeyOverrideSummary[];
}

declare module '@neoworks/extension-system' {
	interface Context {
		shortcuts: ShortcutsService;
	}
}

/** The user-facing side of the keymap: presets, rebinding with conflict checks, JSON export. */
export class ShortcutsService extends Service {
	// Mutated in place, never reassigned: the service is reached through per-caller proxies.
	private readonly disposers = new Map<string, () => void>();

	constructor(
		ctx: Context,
		private readonly keymap: KeymapService
	) {
		super(ctx, 'shortcuts');
	}

	/** Reactive. */
	presets(): PresetSummary[] {
		return this.keymap.presets.list().map((preset) => ({ id: preset.id, title: preset.title }));
	}

	/** Reactive: the active preset id. */
	get preset(): string {
		return this.keymap.preset;
	}

	/** Switch preset; bindings follow at once, user overrides stay on top. */
	setPreset(id: string): void {
		if (!this.keymap.presets.has(id)) throw new Error(`unknown shortcut preset "${id}"`);
		this.keymap.setPreset(id);
	}

	/** Reactive: clashes between active bindings. */
	conflicts(): KeyConflict[] {
		return this.keymap.findConflicts();
	}

	/** Reactive: active bindings that already use `key` in `scope`, to show in a rebind dialog. */
	bindingsUsing(key: string, scope: KeyScope = 'global'): KeyBinding[] {
		return this.keymap.bindingsFor(key, scope);
	}

	/** Bind `command` to `key` (null unbinds it) in `scope` as a user override. */
	rebind(
		command: string,
		key: string | null,
		scope: KeyScope = 'global',
		options: RebindOptions = {}
	): RebindResult {
		const conflicts = this.clashesOf(command, key, scope);
		const policy = options.onConflict ?? 'refuse';
		if (conflicts.length > 0 && policy === 'refuse') return { applied: false, conflicts };
		if (policy === 'replace') {
			for (const binding of conflicts) this.setOverride(scope, binding.command, null);
		}
		this.setOverride(scope, command, key);
		return { applied: true, conflicts };
	}

	/** Drop the user's override of `command`; the preset or default binding applies again. */
	reset(command: string, scope: KeyScope = 'global'): void {
		this.disposeOverride(scope, command);
		this.keymap.removeOverride(scope, command);
	}

	resetAll(): void {
		for (const override of this.keymap.listOverrides())
			this.reset(override.command, override.scope);
	}

	overrides(): KeyOverrideSummary[] {
		return this.keymap.listOverrides();
	}

	/** The preset and overrides as JSON text, to save or share. */
	exportOverrides(): string {
		const data: ExportedOverrides = {
			version: 1,
			preset: this.keymap.preset,
			overrides: this.keymap.listOverrides()
		};
		return JSON.stringify(data, null, 2);
	}

	/** Replace the user's overrides (and the preset) with an exported set; throws on bad input. */
	importOverrides(text: string): void {
		const data = parseExported(text);
		if (!this.keymap.presets.has(data.preset)) {
			throw new Error(`unknown shortcut preset "${data.preset}"`);
		}
		for (const override of data.overrides) {
			if (override.key !== null) this.keymap.bindingsFor(override.key, override.scope);
		}
		this.resetAll();
		this.keymap.setPreset(data.preset);
		for (const override of data.overrides)
			this.setOverride(override.scope, override.command, override.key);
	}

	/** Apply overrides restored from storage. Returns the disposer that removes them all. */
	restore(overrides: KeyOverrideSummary[]): () => void {
		for (const override of overrides)
			this.setOverride(override.scope, override.command, override.key);
		return () => {
			for (const dispose of this.disposers.values()) dispose();
			this.disposers.clear();
		};
	}

	snapshotState(): unknown {
		return { preset: this.keymap.preset, overrides: this.keymap.listOverrides().length };
	}

	private clashesOf(command: string, key: string | null, scope: KeyScope): KeyBinding[] {
		if (key === null) return [];
		return this.keymap.bindingsFor(key, scope).filter((binding) => binding.command !== command);
	}

	private setOverride(scope: KeyScope, command: string, key: string | null): void {
		this.disposeOverride(scope, command);
		this.disposers.set(overrideId(scope, command), this.keymap.setOverride(scope, command, key));
	}

	private disposeOverride(scope: KeyScope, command: string): void {
		const id = overrideId(scope, command);
		this.disposers.get(id)?.();
		this.disposers.delete(id);
	}
}

function overrideId(scope: KeyScope, command: string): string {
	return `${scope}|${command}`;
}

function isOverride(value: unknown): value is KeyOverrideSummary {
	if (typeof value !== 'object' || value === null) return false;
	if (typeof Reflect.get(value, 'scope') !== 'string') return false;
	if (typeof Reflect.get(value, 'command') !== 'string') return false;
	const key: unknown = Reflect.get(value, 'key');
	return key === null || typeof key === 'string';
}

function parseExported(text: string): ExportedOverrides {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error('shortcut export is not valid JSON');
	}
	if (typeof parsed !== 'object' || parsed === null)
		throw new Error('shortcut export is malformed');
	const preset: unknown = Reflect.get(parsed, 'preset');
	const overrides: unknown = Reflect.get(parsed, 'overrides');
	if (typeof preset !== 'string' || !Array.isArray(overrides) || !overrides.every(isOverride)) {
		throw new Error('shortcut export is malformed');
	}
	return { version: 1, preset, overrides };
}
