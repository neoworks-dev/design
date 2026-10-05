// Codegen providers of plugins. `CodegenProvider.generate` is synchronous (the Inspect panel reads
// it inside a `$derived`), a plugin's generator lives in a worker and is asynchronous. The bridge:
// the first call for a node answers a placeholder and asks the worker; when the answer arrives it
// is cached under that node object and a reactive version bumps, so the panel reads again and
// finds it. Edits replace the node object, which invalidates the entry by itself.

import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { CodegenBlock, CodegenInput, CodegenProvider } from '../../codegen/types';
import type { CodegenBlockData } from './types';

export class AsyncCodegenCache {
	// Only a version counter is reactive; the entries are plain maps keyed by node object.
	private version = $state(0);
	private readonly entries = new WeakMap<object, SvelteMap<string, CodegenBlock[]>>();
	private readonly pending = new WeakMap<object, SvelteSet<string>>();

	/** Reactive: reading registers a dependency on every future answer. */
	read(node: object, variant: string): CodegenBlock[] | undefined {
		void this.version;
		return this.entries.get(node)?.get(variant);
	}

	/** Ask `produce` once per node and variant; the answer (or the error) lands in the cache. */
	request(node: object, variant: string, produce: () => Promise<unknown>): void {
		let waiting = this.pending.get(node);
		if (waiting === undefined) {
			waiting = new SvelteSet();
			this.pending.set(node, waiting);
		}
		if (waiting.has(variant)) return;
		waiting.add(variant);
		produce().then(
			(answer) => this.store(node, variant, toBlocks(answer)),
			(error: unknown) =>
				this.store(node, variant, [{ title: 'Plugin error', code: describeError(error) }])
		);
	}

	private store(node: object, variant: string, blocks: CodegenBlock[]): void {
		let byVariant = this.entries.get(node);
		if (byVariant === undefined) {
			byVariant = new SvelteMap();
			this.entries.set(node, byVariant);
		}
		byVariant.set(variant, blocks);
		this.version += 1;
	}
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function isBlock(value: unknown): value is CodegenBlockData {
	if (typeof value !== 'object' || value === null) return false;
	return (
		typeof Reflect.get(value, 'title') === 'string' &&
		typeof Reflect.get(value, 'code') === 'string'
	);
}

function toBlocks(answer: unknown): CodegenBlock[] {
	if (!Array.isArray(answer))
		return [{ title: 'Plugin error', code: 'the plugin did not return blocks' }];
	return answer.filter(isBlock).map((block) => ({ title: block.title, code: block.code }));
}

const PLACEHOLDER: CodegenBlock[] = [{ title: 'Plugin', code: 'Generating...' }];

/** A provider for the `codegen` service backed by `generate` in a worker. */
export function pluginCodegenProvider(
	language: { id: string; label: string },
	cache: AsyncCodegenCache,
	generate: (input: {
		nodeId: string;
		node: CodegenInput['node'];
		options: CodegenInput['options'];
	}) => Promise<unknown>
): CodegenProvider {
	return {
		id: language.id,
		label: language.label,
		generate: (input) => {
			const variant = `${input.options.unit}:${input.options.rootFontSize}`;
			const cached = cache.read(input.node, variant);
			if (cached !== undefined) return cached;
			cache.request(input.node, variant, () =>
				generate({ nodeId: input.nodeId, node: input.node, options: input.options })
			);
			return PLACEHOLDER;
		}
	};
}
