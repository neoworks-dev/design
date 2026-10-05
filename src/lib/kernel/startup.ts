// What the page was asked to boot with: safe mode (`?safe=1`, set by main for `--safe-mode` and the
// "restart in safe mode" action), the plugins the user disabled in the boot report dialog
// (persisted in localStorage), and, for QA only, a deliberately failing plugin (`?failplugin=1`).

import type { Plugin } from '@neoworks/extension-system';

export const DISABLED_PLUGINS_KEY = 'design.disabledPlugins';

export interface StartupOptions {
	safeMode: boolean;
	disabled: ReadonlySet<string>;
	failingPlugins: boolean;
}

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export function readDisabledPlugins(storage: StorageLike | undefined): Set<string> {
	if (storage === undefined) return new Set();
	const stored = storage.getItem(DISABLED_PLUGINS_KEY);
	if (stored === null) return new Set();
	try {
		const parsed: unknown = JSON.parse(stored);
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
	} catch {
		return new Set();
	}
}

export function writeDisabledPlugins(
	storage: StorageLike | undefined,
	names: ReadonlySet<string>
): void {
	if (storage === undefined) return;
	storage.setItem(DISABLED_PLUGINS_KEY, JSON.stringify([...names].sort()));
}

export function readStartupOptions(
	search: string,
	storage: StorageLike | undefined
): StartupOptions {
	const parameters = new URLSearchParams(search);
	return {
		safeMode: parameters.get('safe') === '1',
		disabled: readDisabledPlugins(storage),
		failingPlugins: parameters.get('failplugin') === '1'
	};
}

/**
 * The names to leave out of this boot. Safe mode drops every plugin in `optional`; the plugins
 * the user disabled are left out in either mode.
 */
export function namesToDisable(
	plugins: readonly Plugin[],
	optional: ReadonlySet<string>,
	options: StartupOptions
): Set<string> {
	const disabled = new Set(options.disabled);
	if (!options.safeMode) return disabled;
	for (const plugin of plugins) {
		if (plugin.name !== undefined && optional.has(plugin.name)) disabled.add(plugin.name);
	}
	return disabled;
}

/** Deliberately broken plugins for QA and the error UI's tests. */
export const failingPlugins: Plugin[] = [
	{
		name: 'qa-throws-on-mount',
		inject: [],
		apply(): void {
			throw new Error('qa-throws-on-mount: this plugin always fails to mount');
		}
	},
	{
		name: 'qa-waits-for-missing-service',
		inject: ['qaMissingService'],
		apply(): void {}
	}
] as Plugin[];
