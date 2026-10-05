// The `settings` service: stored preferences, applied to plugins through their own `Config`
// schema and `fiber.update` (CLAUDE.md: no parallel settings system).
//
// Plugin keys live under the plugin's id, the app's own keys are bare (`core`). Changing a plugin
// setting validates against the plugin's schema, then calls `fiber.update` on that plugin's
// fibers only. Any `fiber.update` (also one a plugin makes on itself, like a toggle command) is
// persisted through `recordUpdate`, so there is one path to disk. Only values that differ from the
// schema defaults are stored.

import {
	FiberState,
	Service,
	type Context,
	type Fiber,
	type StandardSchemaV1
} from '@neoworks/extension-system';
import type { SettingsData } from '../../../electron/bridge';
import {
	describeIssues,
	describeSchema,
	overridesOf,
	visibleFields,
	type SettingField
} from '../settings/fields';
import type { SettingsState } from './settingsState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		settings: SettingsService;
	}
	interface Events {
		/** Dispatch mode: emit. A core (bare key) setting changed; plugin settings restart the plugin. */
		'settings/core-changed'(values: Record<string, unknown>): void;
	}
}

/** The part of the `desktop` service settings use (the library may not import plugins). */
export interface SettingsDesktop {
	settingsLoad(): Promise<SettingsData>;
	settingsSave(data: SettingsData): Promise<void>;
}

export interface SettingsSection {
	/** Plugin id, or `core`. */
	id: string;
	title: string;
	core: boolean;
	fields: SettingField[];
}

export type SettingsResult = { ok: true } | { ok: false; message: string };

export const CORE_SECTION = 'core';

interface PluginRuntime {
	name: string;
	schema: StandardSchemaV1;
	fibers: Fiber[];
}

function validate(schema: StandardSchemaV1, value: unknown): SettingsResult {
	const result = schema['~standard'].validate(value);
	if (result instanceof Promise) return { ok: false, message: 'async schemas are not supported' };
	if (result.issues) return { ok: false, message: describeIssues(result.issues) };
	return { ok: true };
}

export class SettingsService extends Service {
	private readonly appliedFibers = new WeakSet<Fiber>();
	private pendingSave: Promise<void> = Promise.resolve();

	constructor(
		ctx: Context,
		private readonly desktop: SettingsDesktop,
		private readonly state: SettingsState
	) {
		super(ctx, 'settings');
	}

	// ---------- reads (reactive) ----------

	get data(): SettingsData {
		return this.state.data;
	}

	get loaded(): boolean {
		return this.state.loaded;
	}

	get dialogOpen(): boolean {
		return this.state.dialogOpen;
	}

	get saveError(): string | null {
		return this.state.saveError;
	}

	openDialog(): void {
		this.state.dialogOpen = true;
	}

	closeDialog(): void {
		this.state.dialogOpen = false;
	}

	/** Every section Settings shows: core first, then plugins with a form, by title. */
	sections(): SettingsSection[] {
		const sections: SettingsSection[] = [];
		const coreSchema = this.state.coreSchema;
		if (coreSchema !== null) {
			sections.push({
				id: CORE_SECTION,
				title: 'General',
				core: true,
				fields: visibleFields(describeSchema(coreSchema))
			});
		}
		const plugins: SettingsSection[] = [];
		for (const runtime of this.pluginRuntimes()) {
			const fields = visibleFields(describeSchema(runtime.schema));
			if (fields.length === 0) continue;
			plugins.push({ id: runtime.name, title: runtime.name, core: false, fields });
		}
		plugins.sort((left, right) => left.title.localeCompare(right.title));
		return [...sections, ...plugins];
	}

	/** The stored override for a field, else its default. */
	valueOf(section: SettingsSection, field: SettingField): unknown {
		const stored = this.storedFor(section.id);
		if (field.key in stored) return stored[field.key];
		return field.defaultValue;
	}

	isModified(section: SettingsSection, field: SettingField): boolean {
		return field.key in this.storedFor(section.id);
	}

	// ---------- writes ----------

	/** The schema of the app's own settings; returns the disposer. */
	registerCoreSchema(schema: StandardSchemaV1): () => void {
		this.state.coreSchema = schema;
		return () => {
			if (this.state.coreSchema === schema) this.state.coreSchema = null;
		};
	}

	/** The core setting `key`: the stored value, else the schema default. */
	core(key: string): unknown {
		const stored = this.state.data.core;
		if (key in stored) return stored[key];
		const schema = this.state.coreSchema;
		if (schema === null) return undefined;
		const field = describeSchema(schema).find((candidate) => candidate.key === key);
		if (field === undefined) return undefined;
		return field.defaultValue;
	}

	/** Change one setting. Invalid values are rejected with the schema's message. */
	set(sectionId: string, key: string, value: unknown): SettingsResult {
		const next = { ...this.storedFor(sectionId), [key]: value };
		return this.replaceSection(sectionId, next);
	}

	/** Put one setting back to its default. */
	reset(sectionId: string, key: string): SettingsResult {
		const next = { ...this.storedFor(sectionId) };
		delete next[key];
		return this.replaceSection(sectionId, next);
	}

	/** Put every setting of one section (or of all) back to defaults. */
	resetAll(): SettingsResult {
		let failure: SettingsResult = { ok: true };
		const ids = new Set([CORE_SECTION, ...Object.keys(this.state.data.plugins)]);
		for (const id of ids) {
			const result = this.replaceSection(id, {});
			if (!result.ok) failure = result;
		}
		return failure;
	}

	// ---------- loading and applying ----------

	/** Read the stored preferences and apply them to the plugins that are already running. */
	async load(): Promise<void> {
		this.state.data = await this.desktop.settingsLoad();
		this.state.loaded = true;
		for (const runtime of this.pluginRuntimes()) {
			for (const fiber of runtime.fibers) this.applyStored(fiber);
		}
		this.ctx.emit('settings/core-changed', this.state.data.core);
	}

	/**
	 * A fiber became active: give it its stored overrides once. Plugins that mount after the
	 * preferences were read get them this way.
	 */
	applyStored(fiber: Fiber): void {
		if (!this.state.loaded) return;
		if (fiber.state !== FiberState.ACTIVE) return;
		if (this.appliedFibers.has(fiber)) return;
		this.appliedFibers.add(fiber);
		const name = fiber.runtime?.name;
		if (name === undefined) return;
		const stored = this.state.data.plugins[name];
		if (stored === undefined) return;
		try {
			fiber.update(stored, true);
		} catch (error) {
			this.ctx.logger.warn(`stored settings of "${name}" no longer validate, ignored`, error);
		}
	}

	/** `internal/update` of any fiber: persist its config if the plugin has a settings schema. */
	recordUpdate(fiber: Fiber, config: unknown, noSave: boolean): void {
		if (noSave) return;
		const runtime = fiber.runtime;
		if (!runtime || runtime.name === undefined || runtime.Config === undefined) return;
		const fields = describeSchema(runtime.Config);
		if (fields.length === 0) return;
		this.appliedFibers.add(fiber);
		this.store({
			...this.state.data,
			plugins: this.withSection(this.state.data.plugins, runtime.name, overridesOf(config, fields))
		});
	}

	/** Resolves once the last queued save reached the disk (or failed). */
	settled(): Promise<void> {
		return this.pendingSave;
	}

	snapshotState(): Record<string, unknown> {
		return { dialogOpen: this.state.dialogOpen, coreSchema: this.state.coreSchema !== null };
	}

	// ---------- internals ----------

	private storedFor(sectionId: string): Record<string, unknown> {
		if (sectionId === CORE_SECTION) return this.state.data.core;
		const stored = this.state.data.plugins[sectionId];
		if (stored === undefined) return {};
		return stored;
	}

	private pluginRuntimes(): PluginRuntime[] {
		const found: PluginRuntime[] = [];
		this.ctx.registry.forEach((runtime) => {
			if (runtime.name === undefined || runtime.Config === undefined) return;
			found.push({ name: runtime.name, schema: runtime.Config, fibers: [...runtime.fibers] });
		});
		return found;
	}

	private replaceSection(sectionId: string, next: Record<string, unknown>): SettingsResult {
		if (sectionId === CORE_SECTION) return this.replaceCore(next);
		return this.replacePlugin(sectionId, next);
	}

	private replaceCore(next: Record<string, unknown>): SettingsResult {
		const schema = this.state.coreSchema;
		if (schema === null) return { ok: false, message: 'no core settings are registered' };
		const checked = validate(schema, next);
		if (!checked.ok) return checked;
		this.store({ ...this.state.data, core: next });
		this.ctx.emit('settings/core-changed', next);
		return { ok: true };
	}

	private replacePlugin(sectionId: string, next: Record<string, unknown>): SettingsResult {
		const runtime = this.pluginRuntimes().find((candidate) => candidate.name === sectionId);
		if (runtime === undefined) return { ok: false, message: `no plugin "${sectionId}"` };
		const checked = validate(runtime.schema, next);
		if (!checked.ok) return checked;
		const fibers = runtime.fibers;
		if (fibers.length === 0) {
			this.store({
				...this.state.data,
				plugins: this.withSection(this.state.data.plugins, sectionId, next)
			});
			return { ok: true };
		}
		// `recordUpdate` persists it, through the same hook every other `fiber.update` goes through.
		for (const fiber of fibers) fiber.update(next);
		return { ok: true };
	}

	private withSection(
		plugins: SettingsData['plugins'],
		sectionId: string,
		values: Record<string, unknown>
	): SettingsData['plugins'] {
		const rest = { ...plugins };
		delete rest[sectionId];
		if (Object.keys(values).length === 0) return rest;
		return { ...rest, [sectionId]: values };
	}

	/** Make `data` the truth and write it, one save after the other so the last always wins. */
	private store(data: SettingsData): void {
		this.state.data = data;
		this.pendingSave = this.pendingSave.then(() =>
			this.desktop.settingsSave(this.state.data).then(
				() => {
					this.state.saveError = null;
				},
				(error: unknown) => {
					this.state.saveError = error instanceof Error ? error.message : String(error);
				}
			)
		);
	}
}
