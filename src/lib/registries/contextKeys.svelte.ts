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

	constructor(ctx: Context) {
		super(ctx, 'contextKeys');
	}

	/** Publish `value` under `key`. Returns a disposer that unsets it (if still current). */
	set(key: string, value: unknown): () => void {
		return this.registry.register({ id: key, value });
	}

	/** Reactive. `undefined` when no plugin published the key. */
	get(key: string): unknown {
		return this.registry.get(key)?.value;
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

	snapshotState(): Record<string, unknown> {
		return Object.fromEntries(this.registry.listAll().map((entry) => [entry.id, entry.value]));
	}
}
