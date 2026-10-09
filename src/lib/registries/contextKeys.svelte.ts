// Context keys: named facts about the app (`hasSelection`, `canvasFocus`, `textEditing`,
// `selectionKind`) that plugins publish and `when` clauses read, so plugins never import each
// other to learn about each other's state.
//
// Provided by plugin `core-context-keys` as `ctx.contextKeys`:
//
//   ctx.effect(() => ctx.contextKeys.set('hasSelection', true), 'selection key');
//
// `set` follows the registry rules: replace by key, dispose by identity. A disposer restores
// "unset" only if its own value is still the current one.

import { Service, type Context } from '@neoworks/extension-system';
import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { Registry, type RegistryEntry } from './registry.svelte';
import { evaluateWhenExpression, validateWhenExpression } from './whenExpression';

interface ContextKeyEntry extends RegistryEntry {
	value: unknown;
}

declare module '@neoworks/extension-system' {
	interface Context {
		contextKeys: ContextKeysService;
	}
}

export class ContextKeysService extends Service {
	readonly registry = new Registry<ContextKeyEntry>();
	// The current value per key, read by `get`. Reading the registry would make every `when`
	// clause depend on every key: plugins republish keys on each document change, and the app
	// menu, keymap and panels would all re-evaluate on every pointer move of a drag. A SvelteMap
	// only notifies the readers of a key whose value actually changed.
	readonly values = new SvelteMap<string, unknown>();

	constructor(ctx: Context) {
		super(ctx, 'contextKeys');
	}

	/** Publish `value` under `key`. Returns a disposer that unsets it (if still current). */
	set(key: string, value: unknown): () => void {
		const dispose = this.registry.register({ id: key, value });
		this.sync(key);
		return () => {
			dispose();
			this.sync(key);
		};
	}

	/** Reactive. `undefined` when no plugin published the key. */
	get(key: string): unknown {
		return this.values.get(key);
	}

	/** Reactive. An absent expression is always true. Throws on a malformed expression. */
	evaluate(expression: string | undefined): boolean {
		if (expression === undefined) return true;
		return evaluateWhenExpression(expression, (key) => this.get(key));
	}

	/** Throws WhenExpressionError when `expression` is malformed. */
	validate(expression: string): void {
		validateWhenExpression(expression);
	}

	private sync(key: string): void {
		const entry = untrack(() => this.registry.get(key));
		if (entry === undefined) this.values.delete(key);
		else this.values.set(key, entry.value);
	}

	snapshotState(): Record<string, unknown> {
		return Object.fromEntries(this.registry.listAll().map((entry) => [entry.id, entry.value]));
	}
}
