// The `codegen` service: turns a node into code in the language the Inspect panel asks for.
// Languages are providers; the inspect-panel plugin registers CSS, SVG and JSON, and any plugin can
// add more:
//
//   ctx.effect(() => ctx.codegen.register({ id: 'swift', label: 'Swift', generate }), 'swift codegen')
//
// `generate` reads the node with its variables resolved and appends a "Variables" block naming the
// variables the node is bound to.

import { Service, type Context } from '@neoworks/extension-system';
import type { Node, NodeId } from '../document';
import { boundVariableLines } from '../codegen/variables';
import { CodegenSettings } from '../codegen/settings.svelte';
import {
	DEFAULT_CODEGEN_OPTIONS,
	type CodegenBlock,
	type CodegenOptions,
	type CodegenProvider
} from '../codegen/types';
import { Registry, type RegistryEntry } from '../registries/registry.svelte';
import type { DocumentService } from './document';
import type { VariablesService } from './variables';

declare module '@neoworks/extension-system' {
	interface Context {
		codegen: CodegenService;
	}
}

interface ProviderEntry extends RegistryEntry {
	provider: CodegenProvider;
}

export class CodegenService extends Service {
	readonly registry = new Registry<ProviderEntry>();
	readonly settings = new CodegenSettings();

	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		private readonly variables: VariablesService
	) {
		super(ctx, 'codegen');
	}

	/** Add a language; the disposer removes this provider only. */
	register(provider: CodegenProvider): () => void {
		return this.registry.register({ id: provider.id, order: provider.order, provider });
	}

	/** Reactive: the registered languages in picker order. */
	providers(): CodegenProvider[] {
		return this.registry.list().map((entry) => entry.provider);
	}

	provider(id: string): CodegenProvider | undefined {
		return this.registry.get(id)?.provider;
	}

	/** The node with its bound variables resolved, as the providers receive it. */
	resolvedNode(nodeId: NodeId): Node {
		return this.variables.resolvedNode(nodeId);
	}

	/** The options the panel currently asks for (reactive). */
	currentOptions(): CodegenOptions {
		return { ...DEFAULT_CODEGEN_OPTIONS, unit: this.settings.unit };
	}

	/** Code blocks for `nodeId`; empty for an unknown language or a node that cannot be shown. */
	generate(languageId: string, nodeId: NodeId, options?: CodegenOptions): CodegenBlock[] {
		const provider = this.provider(languageId);
		if (provider === undefined || !this.document.has(nodeId)) return [];
		const node = this.variables.resolvedNode(nodeId);
		const blocks = provider.generate({
			nodeId,
			node,
			reader: this.document.reader,
			options: options === undefined ? this.currentOptions() : options
		});
		const raw = this.document.require(nodeId);
		const variableLines = boundVariableLines(raw, (id) => this.variables.variable(id)?.name);
		if (variableLines.length === 0) return blocks;
		return [...blocks, { title: 'Variables', code: variableLines.join('\n') }];
	}

	snapshotState(): unknown {
		return { providers: this.registry.listAll().map((entry) => entry.id) };
	}
}
