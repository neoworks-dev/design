// Regions: named slots (`root`, `left`, `right`, `top-bar`, `canvas`, `toolbar`, `overlay`, ...)
// and the components that fill them. The route renders the `root` region only; which plugin
// fills it, and how that plugin arranges the other regions, is a plugin decision.
//
// Provided by plugin `core-regions` as `ctx.regions`:
//
//   ctx.effect(
//   	() => ctx.regions.register({ id: 'layers/panel', region: 'left', component: LayersPanel }),
//   	'layers panel'
//   );

import { Service, type Context } from '@neoworks/extension-system';
import type { Component } from 'svelte';
import { Registry, type RegistryEntry } from './registry.svelte';

export interface RegionContribution extends RegistryEntry {
	region: string;
	// Contributed components have arbitrary props; `any` is the only type every one of them
	// is assignable to.
	// oxlint-disable-next-line typescript/no-explicit-any
	component: Component<any>;
	props?: Record<string, unknown>;
	/** Reactive visibility predicate; read inside the host, so it may read runes. */
	when?: () => boolean;
}

/** A contribution together with the context of the plugin that registered it. */
export interface RegionEntry extends RegionContribution {
	ctx: Context;
}

class RegionRegistry extends Registry<RegionEntry> {
	protected override isActive(entry: RegionEntry): boolean {
		if (!entry.when) return true;
		return entry.when();
	}
}

declare module '@neoworks/extension-system' {
	interface Context {
		regions: RegionsService;
	}
}

export class RegionsService extends Service {
	readonly registry = new RegionRegistry();

	constructor(ctx: Context) {
		super(ctx, 'regions');
	}

	/**
	 * Register a contribution. Called through a plugin's `ctx.regions`, `this.ctx` is that
	 * plugin's context, so the component later renders with the owning plugin's `ctx`.
	 */
	register(contribution: RegionContribution): () => void {
		return this.registry.register({ ...contribution, ctx: this.ctx });
	}

	/** Reactive: visible contributions of one region, ordered. */
	contributions(region: string): readonly RegionEntry[] {
		return this.registry.list().filter((entry) => entry.region === region);
	}

	/** Reactive: names of regions that have at least one contribution. */
	regionNames(): string[] {
		const names = this.registry.listAll().map((entry) => entry.region);
		return names.filter((name, index) => names.indexOf(name) === index);
	}
}
