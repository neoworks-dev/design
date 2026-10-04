import type { Context } from '@neoworks/extension-system';
import { ContextKeysService } from '../../lib/registries/contextKeys.svelte';

export default {
	name: 'core-context-keys',
	inject: [],
	apply(ctx: Context): void {
		new ContextKeysService(ctx);
	}
};
