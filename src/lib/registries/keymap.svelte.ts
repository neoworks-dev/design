// Keymap: binds key chords to command ids, scoped by context. Provided by plugin `core-keymap`
// as `ctx.keymap`; the plugin installs the window key listeners as effects, the service holds
// the rules and is testable without a DOM.
//
//   ctx.effect(
//   	() => ctx.keymap.register({ key: 'Mod+\\', command: 'workbench-layout.toggle-ui', scope: 'global' }),
//   	'toggle ui shortcut'
//   );
//
// Scopes, most specific first: `text-edit`, `input`, `canvas`, then any custom scope, `global`.
// `input` and `text-edit` are active automatically while the event target is a form field or a
// contenteditable; `canvas` (or any other) is active while a plugin holds `pushScope(name)`.
// While the target is editable only `input` / `text-edit` bindings (or bindings that opt in with
// `allowInEditable`) fire, so typing a letter never triggers a tool shortcut.
//
// Resolution per key event: for each active scope in priority order, user overrides first, then
// the defaults of plugins and of the active preset; the first binding whose command exists, is
// enabled and whose `when` holds wins. Overrides live apart from bindings so presets can be
// swapped (`setPreset`).

import { Service, type Context } from '@neoworks/extension-system';
import {
	chordFromEvent,
	chordKey,
	formatChord,
	parseChord,
	type KeyEventLike,
	type Platform
} from './chord';
import type { CommandsService } from './commands.svelte';
import type { ContextKeysService } from './contextKeys.svelte';
import { Registry, type RegistryEntry } from './registry.svelte';

export type KeyScope = 'global' | 'canvas' | 'text-edit' | 'input' | (string & {});

export interface KeyBindingInput {
	/** Written chord, for example `Mod+Shift+\`. */
	key: string;
	command: string;
	args?: unknown;
	/** Context-key expression; the binding is inactive while false. */
	when?: string;
	scope?: KeyScope;
	/** Plugin id, or `preset:<name>` for preset defaults. Defaults to the registering plugin. */
	source?: string;
	/** Nudge-like commands opt in to key repeat; others ignore auto-repeat. */
	repeat?: boolean;
	/** Fire even while a form field or contenteditable has focus. */
	allowInEditable?: boolean;
	/**
	 * Decides between bindings of the same chord and scope: the higher one is tried first (Esc
	 * cancels the active tool before it clears the selection). Ties keep registration order.
	 */
	priority?: number;
}

export interface KeyBinding extends RegistryEntry {
	chord: string;
	key: string;
	command: string;
	args?: unknown;
	when?: string;
	scope: KeyScope;
	source: string;
	repeat: boolean;
	allowInEditable: boolean;
	priority: number;
}

interface KeyOverride extends RegistryEntry {
	scope: KeyScope;
	command: string;
	/** As written by the user, or null to unbind the command in that scope. */
	key: string | null;
	/** Canonical chord, or null to unbind the command in that scope. */
	chord: string | null;
}

export interface KeyOverrideSummary {
	scope: KeyScope;
	command: string;
	key: string | null;
}

/** One binding of a preset; a null `key` leaves the command unbound in that preset. */
export interface KeyPresetBinding {
	command: string;
	key: string | null;
	scope?: KeyScope;
	args?: unknown;
	when?: string;
}

export interface KeyPresetInput {
	id: string;
	title: string;
	/** Replace the default binding of each listed command while the preset is active. */
	bindings: KeyPresetBinding[];
}

interface PresetBindingEntry {
	command: string;
	scope: KeyScope;
	chord: string | null;
	key: string | null;
	args?: unknown;
	when?: string;
}

interface KeyPreset extends RegistryEntry {
	title: string;
	bindings: PresetBindingEntry[];
}

/** Two active bindings that claim the same chord in the same scope with the same condition. */
export interface KeyConflict {
	scope: KeyScope;
	chord: string;
	bindings: KeyBinding[];
}

/** Priority of user overrides: above every default. */
const OVERRIDE_PRIORITY = 1_000_000;
/** Priority of an active preset's bindings. */
const PRESET_PRIORITY = 1000;

interface ScopeEntry extends RegistryEntry {
	name: KeyScope;
}

interface HoldEntry extends RegistryEntry {
	chord: string;
	onStart: () => void;
	onEnd: () => void;
}

/** Reactive keymap state that is not a list of entries. Not a Service, so runes are fine. */
class KeymapSettings {
	preset = $state('figma');
}

/**
 * The active bindings, recomputed only when bindings, overrides or the preset change. Menus look
 * up an accelerator per item whenever context keys change (every selection change), so this must
 * not be rebuilt per lookup. Not a Service, so runes are fine.
 */
class ActiveBindingsCache {
	readonly #compute: () => KeyBinding[];
	readonly bindings = $derived.by(() => this.#compute());
	readonly chordsByCommand = $derived.by(() => indexChords(this.bindings));

	constructor(compute: () => KeyBinding[]) {
		this.#compute = compute;
	}
}

function indexChords(bindings: readonly KeyBinding[]): Record<string, string[] | undefined> {
	const index: Record<string, string[] | undefined> = Object.create(null);
	for (const binding of bindings) {
		const chords = index[binding.command];
		if (chords) chords.push(binding.chord);
		else index[binding.command] = [binding.chord];
	}
	return index;
}

export interface KeymapOptions {
	/** `process.platform` value; decides what `Mod` means. */
	platform: Platform;
}

declare module '@neoworks/extension-system' {
	interface Context {
		keymap: KeymapService;
	}
}

const SCOPE_PRIORITY: KeyScope[] = ['text-edit', 'input', 'canvas'];
const EDITABLE_SCOPES: KeyScope[] = ['text-edit', 'input'];
const TEXT_INPUT_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];

export function isContentEditableTarget(target: unknown): boolean {
	if (typeof target !== 'object' || target === null) return false;
	if (Reflect.get(target, 'isContentEditable') === true) return true;
	const getAttribute: unknown = Reflect.get(target, 'getAttribute');
	if (typeof getAttribute !== 'function') return false;
	const value: unknown = Reflect.apply(getAttribute, target, ['contenteditable']);
	return value === '' || value === 'true' || value === 'plaintext-only';
}

export function isFormFieldTarget(target: unknown): boolean {
	if (typeof target !== 'object' || target === null) return false;
	const tagName: unknown = Reflect.get(target, 'tagName');
	return typeof tagName === 'string' && TEXT_INPUT_TAGS.includes(tagName.toUpperCase());
}

export interface KeydownEventLike extends KeyEventLike {
	target?: unknown;
	preventDefault?: () => void;
}

export class KeymapService extends Service {
	readonly registry = new Registry<KeyBinding>();
	readonly overrides = new Registry<KeyOverride>();
	readonly presets = new Registry<KeyPreset>();
	readonly scopes = new Registry<ScopeEntry>();
	readonly holds = new Registry<HoldEntry>();
	readonly settings = new KeymapSettings();
	readonly platform: Platform;

	private readonly activeHolds: HoldEntry[] = [];
	private readonly active = new ActiveBindingsCache(() => this.computeActiveBindings());
	// Mutated in place, never reassigned: the service is reached through per-caller proxies.
	private readonly counters = { scope: 0, hold: 0 };

	/** Dependencies are captured from the providing plugin's ctx (see CommandsService). */
	constructor(
		ctx: Context,
		private readonly commands: CommandsService,
		private readonly contextKeys: ContextKeysService,
		options: KeymapOptions
	) {
		super(ctx, 'keymap');
		this.platform = options.platform;
	}

	/** Register a binding; replaces an identical one, the disposer removes only this binding. */
	register(input: KeyBindingInput): () => void {
		if (input.when !== undefined) this.contextKeys.validate(input.when);
		const chord = parseChord(input.key, this.platform);
		const scope = input.scope ?? 'global';
		const source = input.source ?? this.ctx.fiber.name;
		return this.registry.register({
			id: `${source}|${scope}|${chord}|${input.command}`,
			chord,
			key: input.key,
			command: input.command,
			args: input.args,
			when: input.when,
			scope,
			source,
			repeat: input.repeat ?? false,
			allowInEditable: input.allowInEditable ?? false,
			priority: input.priority ?? 0
		});
	}

	/** Rebind `command` in `scope` to `key` for the user; `null` unbinds it. */
	setOverride(scope: KeyScope, command: string, key: string | null): () => void {
		let chord: string | null = null;
		if (key !== null) chord = parseChord(key, this.platform);
		return this.overrides.register({ id: `${scope}|${command}`, scope, command, key, chord });
	}

	/** Drop the user's override of `command` in `scope`, back to the preset or default. */
	removeOverride(scope: KeyScope, command: string): void {
		const entry = this.overrides.get(`${scope}|${command}`);
		if (!entry) return;
		this.overrides.register(entry)();
	}

	/** Reactive: the user's overrides as written, for persisting and export. */
	listOverrides(): KeyOverrideSummary[] {
		return this.overrides
			.list()
			.map((override) => ({ scope: override.scope, command: override.command, key: override.key }));
	}

	/** Register a preset: a named set of bindings that replace the defaults while it is active. */
	registerPreset(input: KeyPresetInput): () => void {
		const bindings = input.bindings.map((binding) => this.presetBindingEntry(binding));
		return this.presets.register({ id: input.id, title: input.title, bindings });
	}

	private presetBindingEntry(binding: KeyPresetBinding): PresetBindingEntry {
		if (binding.when !== undefined) this.contextKeys.validate(binding.when);
		let chord: string | null = null;
		if (binding.key !== null) chord = parseChord(binding.key, this.platform);
		return {
			command: binding.command,
			scope: binding.scope ?? 'global',
			chord,
			key: binding.key,
			args: binding.args,
			when: binding.when
		};
	}

	/** Activate a scope (for example `canvas` while the canvas has focus). */
	pushScope(name: KeyScope): () => void {
		this.counters.scope += 1;
		return this.scopes.register({ id: `scope-${this.counters.scope}`, name });
	}

	get preset(): string {
		return this.settings.preset;
	}

	/** Switch which preset's defaults (bindings with source `preset:<name>`) are active. */
	setPreset(name: string): void {
		this.settings.preset = name;
	}

	/**
	 * Run `onStart` when `key` goes down and `onEnd` when it comes up (temporary tools: Space to
	 * pan, Z to zoom). `onEnd` also runs when the window loses focus or the hold is disposed.
	 */
	hold(key: string, onStart: () => void, onEnd: () => void): () => void {
		const chord = parseChord(key, this.platform);
		this.counters.hold += 1;
		const entry: HoldEntry = { id: `hold-${this.counters.hold}`, chord, onStart, onEnd };
		const dispose = this.holds.register(entry);
		return () => {
			this.endHold(entry);
			dispose();
		};
	}

	/** Reactive: accelerator label of the first active binding of `command`, for menus. */
	lookup(commandId: string): string | undefined {
		const chords = this.lookupChords(commandId);
		if (chords.length === 0) return undefined;
		return formatChord(chords[0], this.platform);
	}

	/** Reactive: canonical chords bound to `command`, overrides first. */
	lookupChords(commandId: string): string[] {
		const chords = this.active.chordsByCommand[commandId];
		if (chords === undefined) return [];
		return [...chords];
	}

	/** Returns true when the event was consumed (a binding or hold matched). */
	handleKeydown(event: KeydownEventLike): boolean {
		const editable = isFormFieldTarget(event.target) || isContentEditableTarget(event.target);
		const chord = chordFromEvent(event);
		if (this.startHold(chord, event, editable)) return true;
		const binding = this.resolve(chord, event, editable);
		if (!binding) return false;
		event.preventDefault?.();
		if (event.repeat && !binding.repeat) return true;
		this.commands.run(binding.command, binding.args).catch(() => undefined);
		return true;
	}

	handleKeyup(event: KeyEventLike): void {
		const key = chordKey(chordFromEvent(event));
		for (const entry of this.activeHolds.slice()) {
			if (chordKey(entry.chord) === key) this.endHold(entry);
		}
	}

	/** Window blur: key-up events are lost, so every running hold ends. */
	handleBlur(): void {
		for (const entry of this.activeHolds.slice()) this.endHold(entry);
	}

	snapshotState(): unknown {
		return { preset: this.settings.preset, activeHolds: this.activeHolds.length };
	}

	private startHold(chord: string, event: KeydownEventLike, editable: boolean): boolean {
		if (editable) return false;
		const entry = this.holds.list().find((candidate) => candidate.chord === chord);
		if (!entry) return false;
		event.preventDefault?.();
		if (event.repeat || this.activeHolds.includes(entry)) return true;
		this.activeHolds.push(entry);
		entry.onStart();
		return true;
	}

	private endHold(entry: HoldEntry): void {
		const index = this.activeHolds.indexOf(entry);
		if (index < 0) return;
		this.activeHolds.splice(index, 1);
		entry.onEnd();
	}

	private activeScopeNames(event: KeydownEventLike): KeyScope[] {
		const names: KeyScope[] = this.scopes.list().map((scope) => scope.name);
		if (isFormFieldTarget(event.target)) names.push('input');
		if (isContentEditableTarget(event.target)) names.push('text-edit');
		const known = SCOPE_PRIORITY.filter((name) => names.includes(name));
		const custom = names.filter(
			(name, index) =>
				name !== 'global' && !SCOPE_PRIORITY.includes(name) && names.indexOf(name) === index
		);
		return [...known, ...custom, 'global'];
	}

	/** Overrides first, then defaults that no override replaced. Reactive. */
	private activeBindings(): KeyBinding[] {
		return this.active.bindings;
	}

	private computeActiveBindings(): KeyBinding[] {
		const overrides = this.overrides.list();
		const fromOverrides: KeyBinding[] = [];
		for (const override of overrides) {
			if (override.chord === null) continue;
			fromOverrides.push(this.bindingForOverride(override, override.chord));
		}
		const presetEntries = this.activePresetBindings();
		const defaults = this.registry.list().filter((binding) => {
			if (!this.isPresetActive(binding)) return false;
			if (hasBindingFor(overrides, binding)) return false;
			return !hasBindingFor(presetEntries, binding);
		});
		const fromPreset = presetEntries
			.filter((entry) => entry.chord !== null && !hasBindingFor(overrides, entry))
			.map((entry) => this.bindingForPreset(entry));
		return sortByPriority([...fromOverrides, ...fromPreset, ...defaults]);
	}

	private activePresetBindings(): PresetBindingEntry[] {
		const preset = this.presets.get(this.settings.preset);
		if (!preset) return [];
		return preset.bindings;
	}

	private bindingForPreset(entry: PresetBindingEntry): KeyBinding {
		return {
			id: `preset|${this.settings.preset}|${entry.scope}|${entry.chord}|${entry.command}`,
			chord: entry.chord ?? '',
			key: entry.key ?? '',
			command: entry.command,
			args: entry.args,
			when: entry.when,
			scope: entry.scope,
			source: `preset:${this.settings.preset}`,
			repeat: false,
			allowInEditable: false,
			priority: PRESET_PRIORITY
		};
	}

	/** Reactive: every active binding in resolution order (overrides, preset, then defaults). */
	bindings(): KeyBinding[] {
		return this.activeBindings();
	}

	/**
	 * Reactive: active bindings that fight over a chord. Two bindings conflict when they share
	 * scope, chord, priority and `when`, but run different commands (or the same command with
	 * different arguments). A higher priority resolves the clash, so it is not reported.
	 */
	findConflicts(): KeyConflict[] {
		const groups: { key: string; bindings: KeyBinding[] }[] = [];
		for (const binding of this.activeBindings()) {
			const key = [binding.scope, binding.chord, binding.priority, binding.when].join('\u0000');
			const group = groups.find((candidate) => candidate.key === key);
			if (group) group.bindings.push(binding);
			else groups.push({ key, bindings: [binding] });
		}
		const conflicts: KeyConflict[] = [];
		for (const { bindings } of groups) {
			if (!isContested(bindings)) continue;
			conflicts.push({ scope: bindings[0].scope, chord: bindings[0].chord, bindings });
		}
		return conflicts;
	}

	/** Reactive: active bindings that would clash with `chord` in `scope` (for a rebind dialog). */
	bindingsFor(chordText: string, scope: KeyScope): KeyBinding[] {
		const chord = parseChord(chordText, this.platform);
		return this.activeBindings().filter(
			(binding) => binding.chord === chord && binding.scope === scope
		);
	}

	private bindingForOverride(override: KeyOverride, chord: string): KeyBinding {
		const original = this.registry
			.list()
			.find((binding) => binding.scope === override.scope && binding.command === override.command);
		return {
			id: `override|${override.id}`,
			chord,
			key: chord,
			command: override.command,
			args: original?.args,
			when: original?.when,
			scope: override.scope,
			source: 'user',
			repeat: original?.repeat ?? false,
			allowInEditable: original?.allowInEditable ?? false,
			priority: OVERRIDE_PRIORITY
		};
	}

	private isPresetActive(binding: KeyBinding): boolean {
		const prefix = 'preset:';
		if (!binding.source.startsWith(prefix)) return true;
		return binding.source.slice(prefix.length) === this.settings.preset;
	}

	private resolve(
		chord: string,
		event: KeydownEventLike,
		editable: boolean
	): KeyBinding | undefined {
		const bindings = this.activeBindings().filter((binding) => binding.chord === chord);
		for (const scope of this.activeScopeNames(event)) {
			const match = bindings.find((binding) => this.isEligible(binding, scope, editable));
			if (match) return match;
		}
		return undefined;
	}

	private isEligible(binding: KeyBinding, scope: KeyScope, editable: boolean): boolean {
		if (binding.scope !== scope) return false;
		if (editable && !binding.allowInEditable && !EDITABLE_SCOPES.includes(scope)) return false;
		if (!this.commands.isEnabled(binding.command)) return false;
		return this.contextKeys.evaluate(binding.when);
	}
}

function hasBindingFor(
	entries: readonly { scope: KeyScope; command: string }[],
	binding: { scope: KeyScope; command: string }
): boolean {
	return entries.some(
		(entry) => entry.scope === binding.scope && entry.command === binding.command
	);
}

/** Stable: bindings of equal priority keep their order. */
function sortByPriority(bindings: KeyBinding[]): KeyBinding[] {
	return bindings
		.map((binding, index) => ({ binding, index }))
		.sort((a, b) => b.binding.priority - a.binding.priority || a.index - b.index)
		.map((item) => item.binding);
}

function isContested(bindings: readonly KeyBinding[]): boolean {
	if (bindings.length < 2) return false;
	const first = bindings[0];
	return bindings.some(
		(binding) =>
			binding.command !== first.command ||
			JSON.stringify(binding.args) !== JSON.stringify(first.args)
	);
}
