// The `variables` service: collections, modes, variables, bindings, and the one `resolve` step
// every consumer reads through (data-model.md section 4). Resolution lives in the pure
// `VariableResolver`; this service adds the kernel side: reactivity, writes through
// `document.apply`, cache invalidation from `document/change`, and the alias-cycle gate on
// `document/before-apply`.
//
//   const width = ctx.variables.resolve(nodeId, 'width');     // bound value or the raw one
//   const view = ctx.variables.resolvedNode(nodeId);          // stored node, bindings applied
//   ctx.variables.bindVariable(nodeId, 'itemSpacing', gapId); // a write, undoable

import { Service, type Context } from '@neoworks/extension-system';
import {
	generateNodeId,
	validateVariableChanges,
	VariableResolver,
	type ApplyMeta,
	type BindingInspection,
	type BoundVariables,
	type Change,
	type DocumentChangeEvent,
	type Node,
	type NodeId,
	type Paint,
	type ResolvedValue,
	type Variable,
	type VariableAlias,
	type VariableCollection,
	type VariableType,
	type VariableValue
} from '../document';
import type { DocumentService } from './document';

declare module '@neoworks/extension-system' {
	interface Context {
		variables: VariablesService;
	}
}

export class VariableBindingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VariableBindingError';
	}
}

/** Holds the resolver, which is replaced when the document is. Not reactive, not a Service. */
export class VariablesState {
	resolver: VariableResolver | null = null;
}

const DEFAULT_VALUES: Record<VariableType, VariableValue> = {
	BOOLEAN: false,
	FLOAT: 0,
	STRING: '',
	COLOR: { r: 0, g: 0, b: 0, a: 1 }
};

type PaintProperty = 'fills' | 'backgrounds';

function aliasTo(variableId: string): VariableAlias {
	return { type: 'VARIABLE_ALIAS', id: variableId };
}

function typeOfProperty(raw: unknown): VariableType | undefined {
	if (typeof raw === 'number' || raw === null) return 'FLOAT';
	if (typeof raw === 'boolean') return 'BOOLEAN';
	if (typeof raw === 'string') return 'STRING';
	return undefined;
}

function withoutKey<T extends object>(record: T | undefined, key: string): Record<string, unknown> {
	const copy: Record<string, unknown> = { ...record };
	delete copy[key];
	return copy;
}

export class VariablesService extends Service {
	/** `document` is captured at construction (the providing plugin injects it). */
	constructor(
		ctx: Context,
		private readonly document: DocumentService,
		private readonly state: VariablesState
	) {
		super(ctx, 'variables');
	}

	// ---------- the resolve step ----------

	/** The stored node with every bound property replaced by its resolved value. Reactive. */
	resolvedNode(id: NodeId): Node {
		this.document.require(id);
		return this.resolver().resolvedNode(id);
	}

	/** Resolved value of one property: the variable's value when bound and resolvable, else raw. */
	resolve(id: NodeId, property: string): unknown {
		this.document.require(id);
		return this.resolver().resolve(id, property);
	}

	/** Value of a variable as seen from `nodeId` (its inherited modes); default modes without. */
	resolveVariable(variableId: string, nodeId?: NodeId): ResolvedValue | undefined {
		void this.document.revision;
		return this.resolver().resolveVariable(variableId, nodeId);
	}

	/** The mode of a collection in effect for a node. */
	modeFor(collectionId: string, nodeId?: NodeId): string | undefined {
		void this.document.revision;
		return this.resolver().modeFor(collectionId, nodeId);
	}

	/** Why a binding applies or not (for the inspector's flag); undefined when unbound. */
	inspectBinding(id: NodeId, property: string): BindingInspection | undefined {
		this.document.require(id);
		return this.resolver().inspectBinding(id, property);
	}

	// ---------- reads ----------

	collections(): VariableCollection[] {
		return this.document.entities('collection');
	}

	collection(id: string): VariableCollection | undefined {
		return this.document.getEntity('collection', id);
	}

	variables(collectionId?: string): Variable[] {
		const all = this.document.entities('variable');
		if (collectionId === undefined) return all;
		return all.filter((variable) => variable.collectionId === collectionId);
	}

	variable(id: string): Variable | undefined {
		return this.document.getEntity('variable', id);
	}

	// ---------- collections and modes ----------

	createCollection(
		name: string,
		modeNames: string[] = ['Mode 1'],
		meta?: Partial<ApplyMeta>
	): string {
		if (modeNames.length === 0) throw new VariableBindingError('a collection needs a mode');
		const modes = modeNames.map((modeName) => ({ modeId: generateNodeId(), name: modeName }));
		const created: VariableCollection = {
			id: generateNodeId(),
			name,
			modes,
			defaultModeId: modes[0].modeId,
			variableIds: []
		};
		this.commit(this.document.addEntity('collection', created), 'Create variable collection', meta);
		return created.id;
	}

	renameCollection(id: string, name: string, meta?: Partial<ApplyMeta>): void {
		this.commit(
			this.document.setEntityProps('collection', id, { name }),
			'Rename collection',
			meta
		);
	}

	/** Adds a mode; variables fall back to the default mode's value until it is set. */
	addMode(collectionId: string, name: string, meta?: Partial<ApplyMeta>): string {
		const collection = this.requireCollection(collectionId);
		const mode = { modeId: generateNodeId(), name };
		this.commit(
			this.document.setEntityProps('collection', collectionId, {
				modes: [...collection.modes, mode]
			}),
			'Add mode',
			meta
		);
		return mode.modeId;
	}

	renameMode(collectionId: string, modeId: string, name: string, meta?: Partial<ApplyMeta>): void {
		const collection = this.requireCollection(collectionId);
		this.requireMode(collection, modeId);
		const modes = collection.modes.map((mode) =>
			mode.modeId === modeId ? { ...mode, name } : mode
		);
		this.commit(
			this.document.setEntityProps('collection', collectionId, { modes }),
			'Rename mode',
			meta
		);
	}

	setDefaultMode(collectionId: string, modeId: string, meta?: Partial<ApplyMeta>): void {
		const collection = this.requireCollection(collectionId);
		this.requireMode(collection, modeId);
		this.commit(
			this.document.setEntityProps('collection', collectionId, { defaultModeId: modeId }),
			'Change default mode',
			meta
		);
	}

	/** Removes a mode and its values; the default moves to the first remaining mode if needed. */
	removeMode(collectionId: string, modeId: string, meta?: Partial<ApplyMeta>): void {
		const collection = this.requireCollection(collectionId);
		this.requireMode(collection, modeId);
		if (collection.modes.length === 1) {
			throw new VariableBindingError('cannot remove the last mode of a collection');
		}
		const modes = collection.modes.filter((mode) => mode.modeId !== modeId);
		const defaultModeId =
			collection.defaultModeId === modeId ? modes[0].modeId : collection.defaultModeId;
		const changes: Change[] = [
			...this.document.setEntityProps('collection', collectionId, { modes, defaultModeId })
		];
		for (const variable of this.variables(collectionId)) {
			if (!(modeId in variable.valuesByMode)) continue;
			changes.push(
				...this.document.setEntityProps('variable', variable.id, {
					valuesByMode: withoutKey(variable.valuesByMode, modeId)
				})
			);
		}
		this.commit(changes, 'Remove mode', meta);
	}

	// ---------- variables ----------

	/** Creates a variable; modes without a given value get the type's default. */
	createVariable(
		collectionId: string,
		name: string,
		type: VariableType,
		valuesByMode: Record<string, VariableValue> = {},
		meta?: Partial<ApplyMeta>
	): string {
		const collection = this.requireCollection(collectionId);
		const values: Record<string, VariableValue> = {};
		for (const mode of collection.modes) {
			const given = valuesByMode[mode.modeId];
			values[mode.modeId] = given === undefined ? DEFAULT_VALUES[type] : given;
		}
		const created: Variable = {
			id: generateNodeId(),
			name,
			collectionId,
			resolvedType: type,
			valuesByMode: values,
			scopes: [],
			codeSyntax: {},
			description: ''
		};
		this.commit(
			[
				...this.document.addEntity('variable', created),
				...this.document.setEntityProps('collection', collectionId, {
					variableIds: [...collection.variableIds, created.id]
				})
			],
			'Create variable',
			meta
		);
		return created.id;
	}

	setVariableValue(
		variableId: string,
		modeId: string,
		value: VariableValue,
		meta?: Partial<ApplyMeta>
	): void {
		const variable = this.requireVariable(variableId);
		const collection = this.requireCollection(variable.collectionId);
		this.requireMode(collection, modeId);
		this.commit(
			this.document.setEntityProps('variable', variableId, {
				valuesByMode: { ...variable.valuesByMode, [modeId]: value }
			}),
			'Change variable value',
			{ mergeKey: `variable-value:${variableId}:${modeId}`, ...meta }
		);
	}

	renameVariable(variableId: string, name: string, meta?: Partial<ApplyMeta>): void {
		this.commit(
			this.document.setEntityProps('variable', variableId, { name }),
			'Rename variable',
			meta
		);
	}

	/** Deletes the variable. Bindings to it keep their raw value (and are flagged by inspect). */
	removeVariable(variableId: string, meta?: Partial<ApplyMeta>): void {
		const variable = this.requireVariable(variableId);
		const collection = this.requireCollection(variable.collectionId);
		this.commit(
			[
				...this.document.removeEntity('variable', variableId),
				...this.document.setEntityProps('collection', collection.id, {
					variableIds: collection.variableIds.filter((id) => id !== variableId)
				})
			],
			'Delete variable',
			meta
		);
	}

	// ---------- bindings ----------

	/** Bind a scalar property of a node to a variable; the raw value stays as the fallback. */
	bindVariable(
		nodeId: NodeId,
		property: string,
		variableId: string,
		meta?: Partial<ApplyMeta>
	): void {
		const node = this.document.require(nodeId);
		const variable = this.requireVariable(variableId);
		if (!Reflect.has(node, property)) {
			throw new VariableBindingError(`${node.type} ${nodeId} has no property "${property}"`);
		}
		const propertyType = typeOfProperty(Reflect.get(node, property));
		if (propertyType === undefined) {
			throw new VariableBindingError(`property "${property}" is not a scalar and cannot be bound`);
		}
		if (propertyType !== variable.resolvedType) {
			throw new VariableBindingError(
				`cannot bind ${propertyType} property "${property}" to ${variable.resolvedType} variable ${variable.name}`
			);
		}
		const boundVariables = { ...node.boundVariables, [property]: aliasTo(variableId) };
		this.commit(this.document.setProps(nodeId, { boundVariables }), 'Bind variable', meta);
	}

	/** Remove the binding and keep what the property currently resolves to (detach). */
	unbind(nodeId: NodeId, property: string, meta?: Partial<ApplyMeta>): void {
		const node = this.document.require(nodeId);
		if (!node.boundVariables || !(property in node.boundVariables)) return;
		const props: Record<string, unknown> = {
			boundVariables: withoutKey(node.boundVariables, property)
		};
		if (Reflect.has(node, property)) props[property] = this.resolve(nodeId, property);
		this.commit(this.document.setProps(nodeId, props), 'Unbind variable', meta);
	}

	/** Bind the color of a solid paint in `fills` (or a page's `backgrounds`) to a COLOR variable. */
	bindPaintColor(
		nodeId: NodeId,
		property: PaintProperty,
		index: number,
		variableId: string,
		meta?: Partial<ApplyMeta>
	): void {
		const variable = this.requireVariable(variableId);
		if (variable.resolvedType !== 'COLOR') {
			throw new VariableBindingError(
				`paint color needs a COLOR variable, got ${variable.resolvedType}`
			);
		}
		this.commit(
			this.document.setProps(nodeId, {
				[property]: this.editPaint(nodeId, property, index, (paint) => ({
					...paint,
					boundVariables: { ...paint.boundVariables, color: aliasTo(variableId) }
				}))
			}),
			'Bind variable',
			meta
		);
	}

	/** Detach the paint color: it keeps the color it currently resolves to. */
	unbindPaintColor(
		nodeId: NodeId,
		property: PaintProperty,
		index: number,
		meta?: Partial<ApplyMeta>
	): void {
		const resolved = this.resolvedPaint(nodeId, property, index);
		this.commit(
			this.document.setProps(nodeId, {
				[property]: this.editPaint(nodeId, property, index, (paint) =>
					detachedPaint(resolved, paint.boundVariables)
				)
			}),
			'Unbind variable',
			meta
		);
	}

	/** Set (or with `null` clear) the explicit mode of a collection on a frame, section or page. */
	setExplicitMode(
		nodeId: NodeId,
		collectionId: string,
		modeId: string | null,
		meta?: Partial<ApplyMeta>
	): void {
		const node = this.document.require(nodeId);
		if (!this.supportsExplicitModes(node)) {
			throw new VariableBindingError(`${node.type} cannot set variable modes`);
		}
		const collection = this.requireCollection(collectionId);
		if (modeId !== null) this.requireMode(collection, modeId);
		const existing: unknown = Reflect.get(node, 'explicitVariableModes');
		const current: Record<string, string> = {};
		if (typeof existing === 'object' && existing !== null) Object.assign(current, existing);
		if (modeId === null) delete current[collectionId];
		else current[collectionId] = modeId;
		const props: Record<string, unknown> = {
			explicitVariableModes: Object.keys(current).length === 0 ? undefined : current
		};
		this.commit(this.document.setProps(nodeId, props), 'Change variable mode', meta);
	}

	// ---------- hooks wired by the plugin ----------

	/** `document/before-apply`: refuse alias cycles, bad aliases and mistyped values. */
	validate(changes: Change[]): void {
		validateVariableChanges(this.document.reader, changes);
	}

	/** `document/change`: drop the cache entries the transaction made stale. */
	handleDocumentChange(event: DocumentChangeEvent): void {
		this.resolver().onChange(event.transaction.changes);
	}

	/** `document/replace`: the resolver belongs to the old store. */
	handleDocumentReplace(): void {
		this.state.resolver = null;
	}

	snapshotState(): Record<string, unknown> {
		const resolver = this.state.resolver;
		return { cached: resolver === null ? 0 : resolver.cachedCount };
	}

	// ---------- internals ----------

	private resolver(): VariableResolver {
		void this.document.revision;
		const reader = this.document.reader;
		if (this.state.resolver === null) this.state.resolver = new VariableResolver(reader);
		return this.state.resolver;
	}

	private commit(changes: Change[], label: string, meta?: Partial<ApplyMeta>): void {
		this.document.apply(changes, { origin: 'user', label, ...meta });
	}

	private requireCollection(id: string): VariableCollection {
		const collection = this.document.getEntity('collection', id);
		if (!collection) throw new VariableBindingError(`collection not found: ${id}`);
		return collection;
	}

	private requireVariable(id: string): Variable {
		const variable = this.document.getEntity('variable', id);
		if (!variable) throw new VariableBindingError(`variable not found: ${id}`);
		return variable;
	}

	private requireMode(collection: VariableCollection, modeId: string): void {
		if (collection.modes.some((mode) => mode.modeId === modeId)) return;
		throw new VariableBindingError(`mode ${modeId} is not in collection ${collection.name}`);
	}

	private supportsExplicitModes(node: Node): boolean {
		return ['PAGE', 'FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(
			node.type
		);
	}

	private paintsOf(nodeId: NodeId, property: PaintProperty): Paint[] {
		const node = this.document.require(nodeId);
		const paints: unknown = Reflect.get(node, property);
		if (!Array.isArray(paints)) {
			throw new VariableBindingError(`${node.type} ${nodeId} has no ${property}`);
		}
		return paints as Paint[];
	}

	private editPaint(
		nodeId: NodeId,
		property: PaintProperty,
		index: number,
		edit: (paint: Paint) => Paint
	): Paint[] {
		const paints = this.paintsOf(nodeId, property);
		const paint = paints[index];
		if (paint === undefined || paint.type !== 'SOLID') {
			throw new VariableBindingError(`${property}[${index}] is not a solid paint`);
		}
		return paints.map((existing, position) => (position === index ? edit(existing) : existing));
	}

	private resolvedPaint(nodeId: NodeId, property: PaintProperty, index: number): Paint {
		const resolved = this.resolvedNode(nodeId);
		const paints: unknown = Reflect.get(resolved, property);
		if (!Array.isArray(paints) || paints[index] === undefined) {
			throw new VariableBindingError(`${property}[${index}] does not exist`);
		}
		return paints[index] as Paint;
	}
}

/** The resolved paint, keeping the bindings of `original` other than `color`. */
function detachedPaint(resolved: Paint, original: BoundVariables | undefined): Paint {
	const { boundVariables: _resolvedBindings, ...rest } = resolved;
	const remaining: BoundVariables = { ...original };
	delete remaining.color;
	if (Object.keys(remaining).length === 0) return rest as Paint;
	return { ...rest, boundVariables: remaining } as Paint;
}
