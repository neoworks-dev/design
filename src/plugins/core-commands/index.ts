import type { Context } from '@neoworks/extension-system';
import { CommandsService } from '../../lib/registries/commands.svelte';

export default {
	name: 'core-commands',
	inject: ['contextKeys'],
	apply(ctx: Context): void {
		new CommandsService(ctx, ctx.contextKeys);
	}
};
