// Base class of every contribution point (regions, commands, keymap, ...).
//
// A registry holds entries keyed by `id` and hands back a disposer from `register`:
//
//   const dispose = registry.register({ id: 'a', ... })
//
// Two rules make it safe under hot unload and plugin reloads:
//
// 1. Replace by id. Registering an id that exists swaps the entry in place (same position).
// 2. Dispose by identity. A disposer removes only the exact entry object it registered. If the
//    id was replaced since, the stale disposer does nothing, so an old plugin instance can never
//    delete the entry of its successor. Calling a disposer twice is a no-op.
//
// State is `$state.raw` and replaced wholesale, never mutated. `$state` (deep) would wrap entries
// in proxies and break the identity comparison above.
//
// Why registries and not services hold the runes: a `Service` subclass is re-created through
// `Object.create(service)` by `ctx.isolate` / `ctx.intercept`. Svelte compiles `$state` fields
// into private class fields, and reading one through a derived object throws. A service
// therefore keeps its registry in a plain readonly field and delegates to it; the registry
// itself is never re-created that way. The same goes for `#private` members of a service: a
// call through a derived object throws "Receiver must be an instance". Use TS `private`.

export interface RegistryEntry {
	id: string;
	/** Ascending. Entries without `order` sort as 0; ties keep registration order. */
	order?: number;
}

export class Registry<T extends RegistryEntry> {
	#entries = $state.raw<T[]>([]);
	#sorted = $derived(sortEntries(this.#entries));

	register(entry: T): () => void {
		const index = this.#entries.findIndex((existing) => existing.id === entry.id);
		if (index >= 0) {
			this.#entries = this.#entries.map((existing, position) =>
				position === index ? entry : existing
			);
		} else {
			this.#entries = [...this.#entries, entry];
		}
		return () => this.#removeEntry(entry);
	}

	get(id: string): T | undefined {
		return this.#entries.find((entry) => entry.id === id);
	}

	has(id: string): boolean {
		return this.get(id) !== undefined;
	}

	/** Reactive: entries ordered by `order`, filtered by `isActive`. */
	list(): readonly T[] {
		return this.#sorted.filter((entry) => this.isActive(entry));
	}

	/** Reactive: every entry, including ones `isActive` hides. */
	listAll(): readonly T[] {
		return this.#sorted;
	}

	/** Hook for subclasses: hide entries from `list()` (for example a `when` predicate). */
	protected isActive(_entry: T): boolean {
		return true;
	}

	#removeEntry(entry: T): void {
		if (!this.#entries.includes(entry)) return;
		this.#entries = this.#entries.filter((existing) => existing !== entry);
	}
}

function sortEntries<T extends RegistryEntry>(entries: readonly T[]): T[] {
	const indexed = entries.map((entry, index) => ({ entry, index }));
	indexed.sort((a, b) => {
		const byOrder = (a.entry.order ?? 0) - (b.entry.order ?? 0);
		if (byOrder !== 0) return byOrder;
		return a.index - b.index;
	});
	return indexed.map((item) => item.entry);
}
