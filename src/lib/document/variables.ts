// Variable resolution: the derived layer step every consumer reads through (data-model.md
// section 4). Pure: no kernel, no Svelte.
//
// Binding model. Any bindable property records its binding in `boundVariables` and keeps its raw
// value as the last resolved fallback:
//   node          `node.boundVariables[prop]`: a single alias for a scalar property of the node
//                 (`width`, `opacity`, `itemSpacing`, ...)
//   paint         `paint.boundVariables.color` (solid), `stop.boundVariables.color` (gradient)
//   effect        `effect.boundVariables` keys `color`, `radius`, `spread`, `offsetX`, `offsetY`
//   text style    `style.boundVariables` keys `fontSize`, `fontWeight`, `fontFamily`,
//                 `letterSpacing`, `lineHeight` (on `defaultStyle` and on run deltas)
//
// Resolution. The mode of a collection for a node is the first `explicitVariableModes[collection]`
// found walking from the node up to its page (a mode id the collection no longer has is ignored),
// else the collection's default mode. An alias is followed in the mode of the *target's*
// collection for the same node. A mode without a value falls back to the default mode's value.
// A binding that cannot resolve (variable or collection missing, cycle, value of another type)
// leaves the raw property value in place.
//
// Cache. `VariableResolver` caches the resolved node per node id and records which variables and
// collections each entry read, alias chains included. `onChange` drops exactly the entries a
// change can affect: the changed nodes, the subtree below a node whose modes or position changed,
// and the nodes that read a changed variable or collection (mode list / default mode only).

import { InvalidChangeError } from './apply';
import { styledNode } from './styleProps';
import type { DocumentReader } from './store';
import type {
	BoundVariables,
	Change,
	Effect,
	Node,
	NodeId,
	Paint,
	Paragraph,
	RGBA,
	ShadowEffect,
	TextStyle,
	Variable,
	VariableAlias,
	VariableCollection,
	VariableType,
	VariableValue
} from './types';

export type ResolvedValue = boolean | number | string | RGBA;

// ---------- value helpers ----------

export function isVariableAlias(value: unknown): value is VariableAlias {
	if (typeof value !== 'object' || value === null) return false;
	return (
		Reflect.get(value, 'type') === 'VARIABLE_ALIAS' && typeof Reflect.get(value, 'id') === 'string'
	);
}

function isColor(value: unknown): value is RGBA {
	if (typeof value !== 'object' || value === null) return false;
	return ['r', 'g', 'b', 'a'].every((key) => typeof Reflect.get(value, key) === 'number');
}

/** Does `value` (not an alias) have the runtime type `type` requires? */
export function valueMatchesType(value: unknown, type: VariableType): boolean {
	switch (type) {
		case 'BOOLEAN':
			return typeof value === 'boolean';
		case 'FLOAT':
			return typeof value === 'number';
		case 'STRING':
			return typeof value === 'string';
		case 'COLOR':
			return isColor(value);
	}
}

// ---------- write-time validation ----------

export class AliasCycleError extends InvalidChangeError {
	constructor(readonly path: string[]) {
		super(`variable alias cycle: ${path.join(' -> ')}`, -1);
		this.name = 'AliasCycleError';
	}
}

export class InvalidAliasError extends InvalidChangeError {
	constructor(reason: string) {
		super(reason, -1);
		this.name = 'InvalidAliasError';
	}
}

/** The variables as they would be after `changes`, falling back to the stored ones. */
class VariableOverlay {
	private readonly overrides = new Map<string, Variable | null>();

	constructor(private readonly store: DocumentReader) {}

	get(id: string): Variable | undefined {
		if (this.overrides.has(id)) {
			const override = this.overrides.get(id);
			if (override === null || override === undefined) return undefined;
			return override;
		}
		return this.store.getEntity('variable', id);
	}

	apply(changes: Change[]): Set<string> {
		const touched = new Set<string>();
		for (const change of changes) {
			if (change.t === 'entity-add' && change.kind === 'variable') {
				this.overrides.set(change.entity.id, change.entity);
				touched.add(change.entity.id);
			}
			if (change.t === 'entity-del' && change.kind === 'variable') {
				this.overrides.set(change.entity.id, null);
				touched.delete(change.entity.id);
			}
			if (change.t === 'entity-set' && change.kind === 'variable') {
				const current = this.get(change.id);
				if (!current) continue;
				this.overrides.set(change.id, { ...current, ...change.set } as Variable);
				touched.add(change.id);
			}
		}
		return touched;
	}
}

/**
 * Reject variable writes that make an alias cycle, point an alias at a missing variable or at one
 * of another type, or store a value of the wrong type. Throws a typed error; changes unrelated to
 * variables pass untouched. Meant for the `document/before-apply` hook.
 */
export function validateVariableChanges(store: DocumentReader, changes: Change[]): void {
	const overlay = new VariableOverlay(store);
	const touched = overlay.apply(changes);
	for (const id of touched) {
		const variable = overlay.get(id);
		if (variable) assertValuesValid(overlay, variable);
	}
	for (const id of touched) assertNoAliasCycle(overlay, id);
}

function assertValuesValid(overlay: VariableOverlay, variable: Variable): void {
	for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
		if (!isVariableAlias(value)) {
			if (valueMatchesType(value, variable.resolvedType)) continue;
			throw new InvalidAliasError(
				`variable ${variable.name}: mode ${modeId} value is not a ${variable.resolvedType}`
			);
		}
		const target = overlay.get(value.id);
		if (!target) {
			throw new InvalidAliasError(`variable ${variable.name} aliases missing variable ${value.id}`);
		}
		if (target.resolvedType !== variable.resolvedType) {
			throw new InvalidAliasError(
				`variable ${variable.name} (${variable.resolvedType}) cannot alias ${target.name} (${target.resolvedType})`
			);
		}
	}
}

function aliasTargets(variable: Variable): string[] {
	const targets: string[] = [];
	for (const value of Object.values(variable.valuesByMode)) {
		if (isVariableAlias(value)) targets.push(value.id);
	}
	return targets;
}

function assertNoAliasCycle(overlay: VariableOverlay, startId: string): void {
	const path: string[] = [];
	const finished = new Set<string>();
	const visit = (id: string): void => {
		if (path.includes(id)) throw new AliasCycleError([...path.slice(path.indexOf(id)), id]);
		if (finished.has(id)) return;
		const variable = overlay.get(id);
		if (!variable) return;
		path.push(id);
		for (const target of aliasTargets(variable)) visit(target);
		path.pop();
		finished.add(id);
	};
	visit(startId);
}

// ---------- resolution ----------

interface Dependencies {
	variables: Set<string>;
	collections: Set<string>;
	styles: Set<string>;
}

interface CacheEntry {
	/** The stored node this was computed from; a different object means the entry is stale. */
	source: Node;
	resolved: Node;
	deps: Dependencies;
}

type Modes = Record<string, string>;

function explicitModesOf(node: Node): Modes | undefined {
	const modes: unknown = Reflect.get(node, 'explicitVariableModes');
	if (typeof modes !== 'object' || modes === null) return undefined;
	return modes as Modes;
}

function modeInChain(chain: Node[], collection: VariableCollection): string {
	for (const node of chain) {
		const modes = explicitModesOf(node);
		if (!modes) continue;
		const chosen = modes[collection.id];
		if (chosen === undefined) continue;
		if (collection.modes.some((mode) => mode.modeId === chosen)) return chosen;
	}
	return collection.defaultModeId;
}

/** Evaluates aliases for one node: its ancestor chain decides modes, reads are recorded. */
class Evaluation {
	readonly deps: Dependencies = { variables: new Set(), collections: new Set(), styles: new Set() };
	private chain: Node[] | undefined;

	constructor(
		private readonly store: DocumentReader,
		private readonly nodeId: NodeId | null
	) {}

	private modeChain(): Node[] {
		if (this.chain) return this.chain;
		if (this.nodeId === null || !this.store.hasNode(this.nodeId)) {
			this.chain = [];
			return this.chain;
		}
		this.chain = [this.store.requireNode(this.nodeId), ...this.store.ancestors(this.nodeId)];
		return this.chain;
	}

	value(variableId: string, seen = new Set<string>()): ResolvedValue | undefined {
		if (seen.has(variableId)) return undefined;
		seen.add(variableId);
		this.deps.variables.add(variableId);
		const variable = this.store.getEntity('variable', variableId);
		if (!variable) return undefined;
		this.deps.collections.add(variable.collectionId);
		const collection = this.store.getEntity('collection', variable.collectionId);
		if (!collection) return undefined;
		const value = valueInMode(variable, modeInChain(this.modeChain(), collection), collection);
		if (value === undefined) return undefined;
		if (isVariableAlias(value)) return this.value(value.id, seen);
		return value;
	}

	modeFor(collectionId: string): string | undefined {
		const collection = this.store.getEntity('collection', collectionId);
		if (!collection) return undefined;
		return modeInChain(this.modeChain(), collection);
	}

	number(alias: VariableAlias): number | undefined {
		const value = this.value(alias.id);
		if (typeof value === 'number') return value;
		return undefined;
	}

	boolean(alias: VariableAlias): boolean | undefined {
		const value = this.value(alias.id);
		if (typeof value === 'boolean') return value;
		return undefined;
	}

	string(alias: VariableAlias): string | undefined {
		const value = this.value(alias.id);
		if (typeof value === 'string') return value;
		return undefined;
	}

	color(alias: VariableAlias): RGBA | undefined {
		const value = this.value(alias.id);
		if (isColor(value)) return value;
		return undefined;
	}
}

function valueInMode(
	variable: Variable,
	modeId: string,
	collection: VariableCollection
): VariableValue | undefined {
	const own = variable.valuesByMode[modeId];
	if (own !== undefined) return own;
	return variable.valuesByMode[collection.defaultModeId];
}

function singleAlias(bindings: BoundVariables | undefined, key: string): VariableAlias | undefined {
	if (!bindings) return undefined;
	const bound = bindings[key];
	if (bound === undefined || Array.isArray(bound)) return undefined;
	return bound;
}

/** `items` with `change` applied to each; the same array when nothing changed. */
function mapChanged<T>(items: T[], change: (item: T) => T): T[] {
	let result: T[] | undefined;
	items.forEach((item, position) => {
		const next = change(item);
		if (next === item) return;
		if (!result) result = [...items];
		result[position] = next;
	});
	if (result) return result;
	return items;
}

function resolvePaint(paint: Paint, evaluation: Evaluation): Paint {
	if (paint.type === 'SOLID') {
		const alias = singleAlias(paint.boundVariables, 'color');
		if (!alias) return paint;
		const color = evaluation.color(alias);
		if (!color) return paint;
		return {
			...paint,
			color: { r: color.r, g: color.g, b: color.b },
			opacity: paint.opacity * color.a
		};
	}
	if (paint.type === 'IMAGE') return paint;
	const stops = mapChanged(paint.gradientStops, (stop) => {
		const alias = singleAlias(stop.boundVariables, 'color');
		if (!alias) return stop;
		const color = evaluation.color(alias);
		if (!color) return stop;
		return { ...stop, color };
	});
	if (stops === paint.gradientStops) return paint;
	return { ...paint, gradientStops: stops };
}

function resolvePaints(paints: Paint[], evaluation: Evaluation): Paint[] {
	return mapChanged(paints, (paint) => resolvePaint(paint, evaluation));
}

function isShadow(effect: Effect): effect is ShadowEffect {
	return effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW';
}

function resolveEffect(effect: Effect, evaluation: Evaluation): Effect {
	const bindings = effect.boundVariables;
	if (!bindings) return effect;
	const radius = singleAlias(bindings, 'radius');
	let result: Effect = effect;
	if (radius) {
		const value = evaluation.number(radius);
		if (value !== undefined) result = { ...result, radius: value };
	}
	if (!isShadow(result)) return result;
	const color = singleAlias(bindings, 'color');
	if (color) {
		const value = evaluation.color(color);
		if (value) result = { ...result, color: value } as Effect;
	}
	const spread = singleAlias(bindings, 'spread');
	if (spread) {
		const value = evaluation.number(spread);
		if (value !== undefined) result = { ...result, spread: value } as Effect;
	}
	return resolveShadowOffset(result, bindings, evaluation);
}

function resolveShadowOffset(
	effect: Effect,
	bindings: BoundVariables,
	evaluation: Evaluation
): Effect {
	if (!isShadow(effect)) return effect;
	const offsetX = singleAlias(bindings, 'offsetX');
	const offsetY = singleAlias(bindings, 'offsetY');
	if (!offsetX && !offsetY) return effect;
	const x = offsetX ? evaluation.number(offsetX) : undefined;
	const y = offsetY ? evaluation.number(offsetY) : undefined;
	return {
		...effect,
		offset: {
			x: x === undefined ? effect.offset.x : x,
			y: y === undefined ? effect.offset.y : y
		}
	};
}

function resolveTextStyle<T extends Partial<TextStyle>>(style: T, evaluation: Evaluation): T {
	const bindings = style.boundVariables;
	if (!bindings) return style;
	const overrides: Partial<TextStyle> = {};
	const fontSize = singleAlias(bindings, 'fontSize');
	if (fontSize) overrides.fontSize = evaluation.number(fontSize);
	const fontWeight = singleAlias(bindings, 'fontWeight');
	if (fontWeight) overrides.fontWeight = evaluation.number(fontWeight);
	const family = singleAlias(bindings, 'fontFamily');
	if (family) {
		const value = evaluation.string(family);
		if (value !== undefined) {
			overrides.fontName = {
				family: value,
				style: style.fontName === undefined ? 'Regular' : style.fontName.style
			};
		}
	}
	const letterSpacing = singleAlias(bindings, 'letterSpacing');
	if (letterSpacing) {
		const value = evaluation.number(letterSpacing);
		if (value !== undefined) {
			const unit = style.letterSpacing === undefined ? 'PIXELS' : style.letterSpacing.unit;
			overrides.letterSpacing = { value, unit };
		}
	}
	const lineHeight = singleAlias(bindings, 'lineHeight');
	if (lineHeight) {
		const value = evaluation.number(lineHeight);
		if (value !== undefined) {
			const current = style.lineHeight;
			const unit = current === undefined || current.unit === 'AUTO' ? 'PIXELS' : current.unit;
			overrides.lineHeight = { value, unit };
		}
	}
	const defined: Partial<TextStyle> = {};
	for (const [key, value] of Object.entries(overrides)) {
		if (value !== undefined) Reflect.set(defined, key, value);
	}
	if (Object.keys(defined).length === 0) return style;
	return { ...style, ...defined };
}

function resolveParagraphs(paragraphs: Paragraph[], evaluation: Evaluation): Paragraph[] {
	return mapChanged(paragraphs, (paragraph) => {
		const runs = mapChanged(paragraph.runs, (run) => {
			const style = resolveTextStyle(run.style, evaluation);
			if (style === run.style) return run;
			return { ...run, style };
		});
		if (runs === paragraph.runs) return paragraph;
		return { ...paragraph, runs };
	});
}

/** The node-level scalar bindings: property name to resolved value, only where it resolves. */
function scalarOverrides(node: Node, evaluation: Evaluation): Record<string, unknown> {
	const overrides: Record<string, unknown> = {};
	const bindings = node.boundVariables;
	if (!bindings) return overrides;
	for (const [property, bound] of Object.entries(bindings)) {
		if (Array.isArray(bound) || !Reflect.has(node, property)) continue;
		const raw: unknown = Reflect.get(node, property);
		let value: ResolvedValue | undefined;
		if (typeof raw === 'number' || raw === null) value = evaluation.number(bound);
		if (typeof raw === 'boolean') value = evaluation.boolean(bound);
		if (typeof raw === 'string') value = evaluation.string(bound);
		if (value !== undefined) overrides[property] = value;
	}
	return overrides;
}

function nestedOverrides(node: Node, evaluation: Evaluation): Record<string, unknown> {
	const overrides: Record<string, unknown> = {};
	if (node.type === 'PAGE') {
		const backgrounds = resolvePaints(node.backgrounds, evaluation);
		if (backgrounds !== node.backgrounds) overrides.backgrounds = backgrounds;
		return overrides;
	}
	if ('fills' in node) {
		const fills = resolvePaints(node.fills, evaluation);
		if (fills !== node.fills) overrides.fills = fills;
	}
	if ('strokes' in node) {
		const strokes = mapChanged(node.strokes, (stroke) => {
			const paints = resolvePaints(stroke.paints, evaluation);
			if (paints === stroke.paints) return stroke;
			return { ...stroke, paints };
		});
		if (strokes !== node.strokes) overrides.strokes = strokes;
	}
	if ('effects' in node) {
		const effects = mapChanged(node.effects, (effect) => resolveEffect(effect, evaluation));
		if (effects !== node.effects) overrides.effects = effects;
	}
	if (node.type === 'TEXT') {
		const paragraphs = resolveParagraphs(node.paragraphs, evaluation);
		if (paragraphs !== node.paragraphs) overrides.paragraphs = paragraphs;
		const defaultStyle = resolveTextStyle(node.defaultStyle, evaluation);
		if (defaultStyle !== node.defaultStyle) overrides.defaultStyle = defaultStyle;
	}
	return overrides;
}

export interface BindingInspection {
	variableId: string;
	/** `ok`, or why the stored raw value is shown instead of the variable's value. */
	status: 'ok' | 'missing-variable' | 'unresolved' | 'type-mismatch';
}

export class VariableResolver {
	/** Resolved nodes computed so far; tests assert invalidation precision with it. */
	computeCount = 0;
	private readonly entries = new Map<NodeId, CacheEntry>();
	private readonly variableDependents = new Map<string, Set<NodeId>>();
	private readonly collectionDependents = new Map<string, Set<NodeId>>();
	private readonly styleDependents = new Map<string, Set<NodeId>>();

	constructor(private readonly store: DocumentReader) {}

	/** The stored node with every bound property replaced by its resolved value. Not mutated. */
	resolvedNode(id: NodeId): Node {
		const node = this.store.requireNode(id);
		const cached = this.entries.get(id);
		if (cached && cached.source === node) return cached.resolved;
		if (cached) this.dropEntry(id);
		const entry = this.compute(node);
		this.entries.set(id, entry);
		this.indexEntry(id, entry);
		return entry.resolved;
	}

	/** Resolved value of one property of a node (the raw value when unbound or unresolved). */
	resolve(id: NodeId, property: string): unknown {
		return Reflect.get(this.resolvedNode(id), property);
	}

	/** Value of a variable as seen from `nodeId` (its modes); default modes when omitted. */
	resolveVariable(variableId: string, nodeId?: NodeId): ResolvedValue | undefined {
		return new Evaluation(this.store, nodeId === undefined ? null : nodeId).value(variableId);
	}

	/** The mode of a collection in effect for a node (explicit on it or an ancestor, else default). */
	modeFor(collectionId: string, nodeId?: NodeId): string | undefined {
		return new Evaluation(this.store, nodeId === undefined ? null : nodeId).modeFor(collectionId);
	}

	/** Why a node-level binding does or does not apply: for the inspector's flag. */
	inspectBinding(id: NodeId, property: string): BindingInspection | undefined {
		const node = this.store.requireNode(id);
		const alias = singleAlias(node.boundVariables, property);
		if (!alias) return undefined;
		if (!this.store.getEntity('variable', alias.id)) {
			return { variableId: alias.id, status: 'missing-variable' };
		}
		const evaluation = new Evaluation(this.store, id);
		const value = evaluation.value(alias.id);
		if (value === undefined) return { variableId: alias.id, status: 'unresolved' };
		const raw: unknown = Reflect.get(node, property);
		const matches =
			(typeof raw === 'number' || raw === null) && typeof value === 'number'
				? true
				: typeof raw === typeof value;
		if (matches) return { variableId: alias.id, status: 'ok' };
		return { variableId: alias.id, status: 'type-mismatch' };
	}

	get cachedCount(): number {
		return this.entries.size;
	}

	/** Drop what `changes` (already applied to the store) can have made stale. */
	onChange(changes: Change[]): void {
		for (const change of changes) {
			switch (change.t) {
				case 'add':
				case 'del':
					this.dropEntry(change.node.id);
					break;
				case 'set':
					this.dropEntry(change.id);
					if ('explicitVariableModes' in change.set) this.dropSubtree(change.id);
					break;
				case 'move':
					this.dropSubtree(change.id);
					break;
				case 'entity-add':
				case 'entity-del':
				case 'entity-set':
					this.dropForEntity(change);
					break;
			}
		}
	}

	snapshotState(): Record<string, unknown> {
		return { cached: this.entries.size };
	}

	// ---------- internals ----------

	private compute(node: Node): CacheEntry {
		this.computeCount += 1;
		const evaluation = new Evaluation(this.store, node.id);
		// Styles first, so the paints and effects a style brings are resolved against variables too.
		const styled = styledNode(node, (styleId) => {
			evaluation.deps.styles.add(styleId);
			return this.store.getEntity('style', styleId);
		});
		const overrides = {
			...scalarOverrides(styled, evaluation),
			...nestedOverrides(styled, evaluation)
		};
		if (Object.keys(overrides).length === 0) {
			return { source: node, resolved: styled, deps: evaluation.deps };
		}
		return { source: node, resolved: { ...styled, ...overrides } as Node, deps: evaluation.deps };
	}

	private indexEntry(id: NodeId, entry: CacheEntry): void {
		for (const variableId of entry.deps.variables) addTo(this.variableDependents, variableId, id);
		for (const collectionId of entry.deps.collections) {
			addTo(this.collectionDependents, collectionId, id);
		}
		for (const styleId of entry.deps.styles) addTo(this.styleDependents, styleId, id);
	}

	private dropEntry(id: NodeId): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.entries.delete(id);
		for (const variableId of entry.deps.variables)
			removeFrom(this.variableDependents, variableId, id);
		for (const collectionId of entry.deps.collections) {
			removeFrom(this.collectionDependents, collectionId, id);
		}
		for (const styleId of entry.deps.styles) removeFrom(this.styleDependents, styleId, id);
	}

	private dropSubtree(id: NodeId): void {
		this.dropEntry(id);
		if (!this.store.hasNode(id)) return;
		for (const descendant of this.store.descendants(id)) this.dropEntry(descendant.id);
	}

	private dropForEntity(change: Extract<Change, { kind: string }>): void {
		const id = change.t === 'entity-set' ? change.id : change.entity.id;
		if (change.kind === 'variable') {
			this.dropDependents(this.variableDependents, id);
			return;
		}
		if (change.kind === 'style') {
			this.dropDependents(this.styleDependents, id);
			return;
		}
		if (change.kind !== 'collection') return;
		if (change.t === 'entity-set' && !changesModes(change.set)) return;
		this.dropDependents(this.collectionDependents, id);
	}

	private dropDependents(index: Map<string, Set<NodeId>>, key: string): void {
		const dependents = index.get(key);
		if (!dependents) return;
		for (const nodeId of dependents) this.dropEntry(nodeId);
	}
}

function changesModes(set: Record<string, unknown>): boolean {
	return 'modes' in set || 'defaultModeId' in set;
}

function addTo(index: Map<string, Set<NodeId>>, key: string, id: NodeId): void {
	const existing = index.get(key);
	if (existing) {
		existing.add(id);
		return;
	}
	index.set(key, new Set([id]));
}

function removeFrom(index: Map<string, Set<NodeId>>, key: string, id: NodeId): void {
	const existing = index.get(key);
	if (!existing) return;
	existing.delete(id);
	if (existing.size === 0) index.delete(key);
}
