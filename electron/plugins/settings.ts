// main-settings: the preferences file (`settings.json` in the user data directory) behind
// `settings:load` and `settings:save`. The renderer owns the schemas (each plugin's `Config`) and
// validates before saving; main only stores what has the right shape. A missing or corrupt file
// reads as "no preferences" so a bad file never blocks startup.

import type { Plugin } from '@neoworks/extension-system';
import { z } from 'zod';
import type { SettingsData } from '../bridge';
import { route } from '../kernel/route';

export const SETTINGS_FILE = 'settings.json';

const storedSettings = z.object({
	core: z.record(z.string(), z.unknown()),
	plugins: z.record(z.string(), z.record(z.string(), z.unknown()))
});

export function emptySettings(): SettingsData {
	return { core: {}, plugins: {} };
}

export function parseSettings(text: string | undefined): SettingsData {
	if (text === undefined) return emptySettings();
	try {
		const parsed = storedSettings.safeParse(JSON.parse(text));
		if (!parsed.success) return emptySettings();
		return parsed.data;
	} catch {
		return emptySettings();
	}
}

export const mainSettingsPlugin: Plugin.Object = {
	name: 'main-settings',
	inject: ['electron', 'ipc'],
	apply(ctx) {
		route(ctx, 'settings:load', () => parseSettings(ctx.electron.userData.readText(SETTINGS_FILE)));
		route(ctx, 'settings:save', (data) => {
			ctx.electron.userData.writeText(SETTINGS_FILE, JSON.stringify(data, null, '\t'));
		});
	}
};
