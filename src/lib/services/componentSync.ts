// The `componentSync` service: queries about components and instances, for the assets panel, the
// inspector and the commands. The sync itself runs as `document/before-apply` and
// `document/append` listeners of the `component-sync` plugin (lib/document/components.ts).
// Stateless on purpose: reads go through `document`, which is reactive.

import { Service, type Context } from '@neoworks/extension-system';
import {
	counterpartIdOf,
	definitionsOf,
	enclosingMain,
	isInsideInstance,
	nodeInMain,
	variantSetOf,
	type ComponentNode,
	type ComponentPropertyDefinition,
	type ComponentSetNode,
	type InstanceNode,
	type Node,
	type NodeId,
	type TouchedGroup
} from '../document';

declare module '@neoworks/extension-system' {
	interface Context {
		componentSync: ComponentSyncService;
	}
}

/** One component for a list (the assets panel): where it is and what set it belongs to. */
export interface ComponentSummary {
	id: NodeId;
	name: string;
	description: string;
	pageId: NodeId;
	setId: NodeId | null;
	setName: string | null;
}

export class ComponentSyncService extends Service {
	constructor(ctx: Context) {
		super(ctx, 'componentSync');
	}

	/** Reactive: every main component in the document, in page and layer order. */
	components(): ComponentSummary[] {
		const summaries: ComponentSummary[] = [];
		for (const node of this.ctx.document.query((candidate) => candidate.type === 'COMPONENT')) {
			if (node.type !== 'COMPONENT') continue;
			summaries.push(this.summarize(node));
		}
		return summaries;
	}

	componentSets(): ComponentSetNode[] {
		const sets: ComponentSetNode[] = [];
		for (const node of this.ctx.document.query((candidate) => candidate.type === 'COMPONENT_SET')) {
			if (node.type === 'COMPONENT_SET') sets.push(node);
		}
		return sets;
	}

	/** The instance node at or above `id`, when `id` is an instance or inside one. */
	instanceOf(id: NodeId): InstanceNode | undefined {
		let current: Node | undefined = this.ctx.document.get(id);
		while (current !== undefined) {
			if (current.type === 'INSTANCE') return current;
			if (current.parentId === null) return undefined;
			current = this.ctx.document.get(current.parentId);
		}
		return undefined;
	}

	/** Whether `id` is inside an instance (instances cannot be restructured freely there). */
	isInsideInstance(id: NodeId): boolean {
		const node = this.ctx.document.get(id);
		if (node === undefined) return false;
		return isInsideInstance(this.ctx.document.reader, node);
	}

	/** The main component an instance (or a layer of one) is a copy of; undefined when deleted. */
	mainOf(id: NodeId): ComponentNode | undefined {
		const instance = this.instanceOf(id);
		if (instance === undefined) return undefined;
		const main = this.ctx.document.get(instance.mainComponentId);
		if (main === undefined || main.type !== 'COMPONENT') return undefined;
		return main;
	}

	/** An instance whose main component was deleted. */
	isOrphan(id: NodeId): boolean {
		const instance = this.instanceOf(id);
		if (instance === undefined) return false;
		return !this.ctx.document.has(instance.mainComponentId);
	}

	/** Reactive: root instances of `mainId` anywhere in the document. */
	instancesOf(mainId: NodeId): InstanceNode[] {
		const found: InstanceNode[] = [];
		for (const node of this.ctx.document.query((candidate) => candidate.type === 'INSTANCE')) {
			if (node.type !== 'INSTANCE' || node.componentRef !== undefined) continue;
			if (node.mainComponentId === mainId) found.push(node);
		}
		return found;
	}

	/** The component that `id` (a layer of a main component, or of an instance) is a copy of. */
	counterpartOf(id: NodeId): Node | undefined {
		const node = this.ctx.document.get(id);
		if (node === undefined) return undefined;
		const counterpartId = counterpartIdOf(node);
		if (counterpartId === undefined) return undefined;
		return this.ctx.document.get(counterpartId);
	}

	/** The main component that contains layer `id`, when `id` is part of one. */
	enclosingMainOf(id: NodeId): ComponentNode | undefined {
		const node = this.ctx.document.get(id);
		if (node === undefined) return undefined;
		const main = enclosingMain(this.ctx.document.reader, node);
		if (main === undefined || main.type !== 'COMPONENT') return undefined;
		return main;
	}

	/** The layer of main `mainId` that `id` is a copy of (through nested instances). */
	layerInMain(id: NodeId, mainId: NodeId): Node | undefined {
		const node = this.ctx.document.get(id);
		if (node === undefined) return undefined;
		return nodeInMain(this.ctx.document.reader, node, mainId);
	}

	overridesOf(id: NodeId): readonly TouchedGroup[] {
		const node = this.ctx.document.get(id);
		if (node === undefined || node.touched === undefined) return [];
		return node.touched;
	}

	variantSetOf(mainId: NodeId): ComponentSetNode | undefined {
		return variantSetOf(this.ctx.document.reader, mainId);
	}

	definitionsOf(mainId: NodeId): Record<string, ComponentPropertyDefinition> {
		return definitionsOf(this.ctx.document.reader, mainId);
	}

	private summarize(component: ComponentNode): ComponentSummary {
		const set = variantSetOf(this.ctx.document.reader, component.id);
		return {
			id: component.id,
			name: component.name,
			description: component.description,
			pageId: this.ctx.document.pageOf(component.id).id,
			setId: set === undefined ? null : set.id,
			setName: set === undefined ? null : set.name
		};
	}
}
