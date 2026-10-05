// The `styles` service: paint, text, effect and grid styles (#113). Reads are reactive (the
// document revision), every write goes through `document.apply`; the planning is pure
// (`lib/styles/plan.ts`). Readers of a styled node get the style's value through the resolver, so
// editing a style updates every consumer, and one undo step takes it back.
//
//   const id = ctx.styles.create('fill', nodeId, 'Brand/Primary'); // from the node's fills, applied
//   ctx.styles.setValue(id, [solidPaint(red)]);                      // every consumer follows
//   ctx.styles.detach('fill', [nodeId]);                             // keeps the values

import { Service, type Context } from '@neoworks/extension-system';
import {
	generateNodeId,
	STYLE_TARGETS,
	styleIdOf,
	type ApplyMeta,
	type Change,
	type Node,
	type NodeId,
	type Style,
	type StyleTarget,
	type StyleType
} from '../document';
import {
	acceptsStyle,
	consumersOf,
	currentStyleValue,
	detachOnEdit,
	planApplyStyle,
	planDetachAll,
	planDetachStyle,
	planSyncConsumers
} from '../styles/plan';
import type { DocumentService } from './document';

declare module '@neoworks/extension-system' {
	interface Context {
		styles: StylesService;
	}
}

export class StyleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StyleError';
	}
}

export class StylesService extends Service {
	/** `document` is captured at construction (the providing plugin injects it). */
	constructor(
		ctx: Context,
		private readonly document: DocumentService
	) {
		super(ctx, 'styles');
	}

	// ---------- reads (reactive) ----------

	list(type?: StyleType): Style[] {
		const styles = this.document.entities('style');
		if (type === undefined) return styles;
		return styles.filter((style) => style.type === type);
	}

	get(id: string): Style | undefined {
		return this.document.getEntity('style', id);
	}

	/** Whether the style button applies to `node` for `target` at all. */
	accepts(node: Node, target: StyleTarget): boolean {
		return acceptsStyle(node, target);
	}

	/** The style every node shares for `target`, `null` when they differ or have none. */
	sharedStyleId(nodeIds: readonly NodeId[], target: StyleTarget): string | null {
		if (nodeIds.length === 0) return null;
		const ids = nodeIds.map((id) => styleIdOf(this.document.require(id), target));
		const [first] = ids;
		if (first === undefined || ids.some((id) => id !== first)) return null;
		return first;
	}

	consumerCount(styleId: string): number {
		void this.document.revision;
		return consumersOf(this.document.reader, styleId).length;
	}

	// ---------- writes ----------

	/** Creates a style from the first node's current value and applies it to every node given. */
	create(
		target: StyleTarget,
		nodeIds: readonly NodeId[],
		name: string,
		meta?: Partial<ApplyMeta>
	): string {
		const [first] = nodeIds;
		if (first === undefined) throw new StyleError('select something to create a style from');
		const value = currentStyleValue(this.document.require(first), target);
		if (value === undefined) throw new StyleError(`nothing to create a ${target} style from`);
		const style: Style = {
			id: generateNodeId(),
			type: STYLE_TARGETS[target].type,
			name,
			description: '',
			value: structuredClone(value)
		};
		const changes: Change[] = [...this.document.addEntity('style', style)];
		this.addApplyChanges(changes, target, style, nodeIds);
		this.commit(changes, 'Create style', meta);
		return style.id;
	}

	apply(
		target: StyleTarget,
		styleId: string,
		nodeIds: readonly NodeId[],
		meta?: Partial<ApplyMeta>
	): void {
		const style = this.requireStyle(styleId);
		const changes: Change[] = [];
		this.addApplyChanges(changes, target, style, nodeIds);
		this.commit(changes, 'Apply style', meta);
	}

	/** Drops the style from the nodes; they keep the values they show now. */
	detach(target: StyleTarget, nodeIds: readonly NodeId[], meta?: Partial<ApplyMeta>): void {
		const changes: Change[] = [];
		for (const id of nodeIds) changes.push(...planDetachStyle(this.document.reader, id, target));
		this.commit(changes, 'Detach style', meta);
	}

	/** Makes the style say what `nodeId` shows now for `target`; consumers follow. */
	redefine(styleId: string, target: StyleTarget, nodeId: NodeId, meta?: Partial<ApplyMeta>): void {
		const value = currentStyleValue(this.document.require(nodeId), target);
		if (value === undefined) throw new StyleError(`nothing to read a ${target} style from`);
		this.setValue(styleId, structuredClone(value), meta);
	}

	/** Edits the style; the `styles` plugin rewrites every consumer in the same transaction. */
	setValue(styleId: string, value: unknown, meta?: Partial<ApplyMeta>): void {
		this.requireStyle(styleId);
		this.commit(this.document.setEntityProps('style', styleId, { value }), 'Edit style', {
			mergeKey: `style-value:${styleId}`,
			...meta
		});
	}

	rename(styleId: string, name: string, meta?: Partial<ApplyMeta>): void {
		this.requireStyle(styleId);
		this.commit(this.document.setEntityProps('style', styleId, { name }), 'Rename style', meta);
	}

	/** Deletes the style; every consumer is detached and keeps its values. */
	remove(styleId: string, meta?: Partial<ApplyMeta>): void {
		this.requireStyle(styleId);
		const changes = [
			...planDetachAll(this.document.reader, styleId),
			...this.document.removeEntity('style', styleId)
		];
		this.commit(changes, 'Delete style', meta);
	}

	// ---------- hooks wired by the plugin ----------

	/** `document/before-apply`: editing a styled value detaches the node from its style. */
	rewriteEdits(changes: Change[]): Change[] {
		return detachOnEdit(this.document.reader, changes);
	}

	/** `document/append`: rewrite the raw copies of the consumers of every style a change edited. */
	syncFor(changes: readonly Change[]): Change[] {
		const edited = new Set<string>();
		for (const change of changes) {
			if (change.t === 'entity-set' && change.kind === 'style' && 'value' in change.set) {
				edited.add(change.id);
			}
			if (change.t === 'entity-add' && change.kind === 'style') edited.add(change.entity.id);
		}
		const planned: Change[] = [];
		for (const styleId of edited) {
			const style = this.get(styleId);
			if (style !== undefined) planned.push(...planSyncConsumers(this.document.reader, style));
		}
		return planned;
	}

	snapshotState(): Record<string, unknown> {
		return {};
	}

	// ---------- internals ----------

	private addApplyChanges(
		changes: Change[],
		target: StyleTarget,
		style: Style,
		nodeIds: readonly NodeId[]
	): void {
		const reader = this.document.reader;
		for (const id of nodeIds) {
			if (!this.accepts(reader.requireNode(id), target)) continue;
			changes.push(...planApplyStyle(reader, id, target, style));
		}
	}

	private commit(changes: Change[], label: string, meta?: Partial<ApplyMeta>): void {
		this.document.apply(changes, { origin: 'user', label, ...meta });
	}

	private requireStyle(id: string): Style {
		const style = this.get(id);
		if (style === undefined) throw new StyleError(`style not found: ${id}`);
		return style;
	}
}
