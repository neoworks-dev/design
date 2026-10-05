import { Service, type Context } from '@neoworks/extension-system';
import { Registry, type RegistryEntry } from '../../lib/registries/registry.svelte';
import type { PaletteItem } from '../command-palette/service';

/** More things the Resources search lists next to components, for example installed plugins. */
export interface ResourceProvider extends RegistryEntry {
	items(query: string): PaletteItem[];
}

declare module '@neoworks/extension-system' {
	interface Context {
		resourceSearch: ResourceSearchService;
	}
}

export class ResourceSearchService extends Service {
	readonly providers = new Registry<ResourceProvider>();

	constructor(ctx: Context) {
		super(ctx, 'resourceSearch');
	}

	/** Add a provider; replaces the same id, the disposer removes only this one. */
	registerProvider(provider: ResourceProvider): () => void {
		return this.providers.register(provider);
	}

	/** Reactive: the items of every provider for `query`. */
	itemsFor(query: string): PaletteItem[] {
		return this.providers.list().flatMap((provider) => provider.items(query));
	}

	snapshotState(): Record<string, unknown> {
		return { providers: this.providers.listAll().map((provider) => provider.id) };
	}
}
