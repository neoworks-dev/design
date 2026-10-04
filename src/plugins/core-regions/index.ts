import type { Context } from '@neoworks/extension-system';
import { RegionsService } from '../../lib/registries/regions.svelte';

export default {
	name: 'core-regions',
	inject: [],
	apply(ctx: Context): void {
		new RegionsService(ctx);
	}
};
