import { z } from 'zod';

/** The app's own settings (bare keys). Plugin settings come from each plugin's `Config`. */
export const coreSettingsSchema = z
	.object({
		theme: z.enum(['dark', 'light']).default('dark').describe('Colour scheme of the interface.')
	})
	.prefault({});
