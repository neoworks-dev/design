// The node objects of the Figma layer: `figma.currentPage.children[0].fills = [...]`. One wrapper
// per node id, reading from and writing to the mirror (mirror.ts). Property names and values are
// Figma's, which the document model already follows; where the model is richer (gradients, several
// strokes) the setters accept the subset that maps and say so otherwise.

import type { Node, Paint } from '../../../document';
import type { DocumentMirror } from './mirror';
import { FigmaCompatError, UNSUPPORTED_NODE_MEMBERS, unsupportedMessage } from './table';

export const FIGMA_MIXED: unique symbol = Symbol('figma.mixed');

/** Properties that map one to one between Figma and the node. */
const DIRECT_PROPERTIES = [
	'name',
	'visible',
	'locked',
	'opacity',
	'clipsContent',
	'constrainProportions',
	'layoutMode',
	'layoutWrap',
	'itemSpacing',
	'paddingTop',
	'paddingRight',
	'paddingBottom',
	'paddingLeft',
	'primaryAxisAlignItems',
	'counterAxisAlignItems',
	'layoutSizingHorizontal',
	'layoutSizingVertical',
	'layoutPositioning'
] as const;

const CONTAINER_TYPES = [
	'PAGE',
	'FRAME',
	'GROUP',
	'SECTION',
	'COMPONENT',
	'COMPONENT_SET',
	'BOOLEAN_OPERATION'
];

export interface FigmaNodeHost {
	mirror: DocumentMirror;
	pluginId: string;
	wrap(id: string): FigmaNode;
}

type Predicate = (node: FigmaNode) => boolean;

function toHex(channel: number): string {
	return Math.round(Math.min(Math.max(channel, 0), 1) * 255)
		.toString(16)
		.padStart(2, '0');
}

interface SolidInput {
	color: string;
	opacity: number;
}

function solidOf(paint: unknown, property: string): SolidInput {
	if (typeof paint !== 'object' || paint === null || Reflect.get(paint, 'type') !== 'SOLID') {
		throw new FigmaCompatError(
			unsupportedMessage(
				`${property} with a ${describePaint(paint)} paint`,
				'only SOLID paints can be set'
			)
		);
	}
	const color: unknown = Reflect.get(paint, 'color');
	if (typeof color !== 'object' || color === null) {
		throw new FigmaCompatError(`${property}: a SOLID paint needs a color`);
	}
	const channels = ['r', 'g', 'b'].map((name) => Reflect.get(color, name));
	if (!channels.every((channel) => typeof channel === 'number')) {
		throw new FigmaCompatError(`${property}: a color needs r, g and b numbers`);
	}
	const opacity: unknown = Reflect.get(paint, 'opacity');
	return {
		color: `#${channels.map((channel) => toHex(Number(channel))).join('')}`,
		opacity: typeof opacity === 'number' ? opacity : 1
	};
}

function describePaint(paint: unknown): string {
	if (typeof paint !== 'object' || paint === null) return 'invalid';
	const type: unknown = Reflect.get(paint, 'type');
	return typeof type === 'string' ? type : 'invalid';
}

function clone<Value>(value: Value): Value {
	return structuredClone(value);
}

export class FigmaNode {
	constructor(
		private readonly host: FigmaNodeHost,
		readonly id: string
	) {}

	private get node(): Node {
		return this.host.mirror.requireNode(this.id);
	}

	private get mirror(): DocumentMirror {
		return this.host.mirror;
	}

	private set(props: Record<string, unknown>): void {
		this.mirror.update(this.id, props);
	}

	get removed(): boolean {
		return !this.mirror.has(this.id);
	}

	get type(): string {
		return this.node.type;
	}

	get name(): string {
		return this.node.name;
	}
	set name(value: string) {
		this.set({ name: value });
	}

	get parent(): FigmaNode | null {
		const { parentId } = this.node;
		if (parentId === null) return null;
		return this.host.wrap(parentId);
	}

	// ---------- plain properties ----------

	private read<Value = unknown>(property: string): Value {
		const value: Value = Reflect.get(this.node, property);
		return value;
	}

	get visible(): boolean {
		return this.read<boolean>('visible');
	}
	set visible(value: boolean) {
		this.set({ visible: value });
	}
	get locked(): boolean {
		return this.read<boolean>('locked');
	}
	set locked(value: boolean) {
		this.set({ locked: value });
	}
	get opacity(): number {
		return this.read<number>('opacity');
	}
	set opacity(value: number) {
		this.set({ opacity: value });
	}
	get clipsContent(): boolean {
		return this.read<boolean>('clipsContent');
	}
	set clipsContent(value: boolean) {
		this.set({ clipsContent: value });
	}
	get constrainProportions(): boolean {
		return this.read<boolean>('constrainProportions');
	}
	set constrainProportions(value: boolean) {
		this.set({ constrainProportions: value });
	}
	get layoutMode(): unknown {
		return this.read('layoutMode');
	}
	set layoutMode(value: unknown) {
		this.set({ layoutMode: value });
	}
	get layoutWrap(): unknown {
		return this.read('layoutWrap');
	}
	set layoutWrap(value: unknown) {
		this.set({ layoutWrap: value });
	}
	get itemSpacing(): unknown {
		return this.read('itemSpacing');
	}
	set itemSpacing(value: unknown) {
		this.set({ itemSpacing: value });
	}
	get paddingTop(): unknown {
		return this.read('paddingTop');
	}
	set paddingTop(value: unknown) {
		this.set({ paddingTop: value });
	}
	get paddingRight(): unknown {
		return this.read('paddingRight');
	}
	set paddingRight(value: unknown) {
		this.set({ paddingRight: value });
	}
	get paddingBottom(): unknown {
		return this.read('paddingBottom');
	}
	set paddingBottom(value: unknown) {
		this.set({ paddingBottom: value });
	}
	get paddingLeft(): unknown {
		return this.read('paddingLeft');
	}
	set paddingLeft(value: unknown) {
		this.set({ paddingLeft: value });
	}
	get primaryAxisAlignItems(): unknown {
		return this.read('primaryAxisAlignItems');
	}
	set primaryAxisAlignItems(value: unknown) {
		this.set({ primaryAxisAlignItems: value });
	}
	get counterAxisAlignItems(): unknown {
		return this.read('counterAxisAlignItems');
	}
	set counterAxisAlignItems(value: unknown) {
		this.set({ counterAxisAlignItems: value });
	}
	get layoutSizingHorizontal(): unknown {
		return this.read('layoutSizingHorizontal');
	}
	set layoutSizingHorizontal(value: unknown) {
		this.set({ layoutSizingHorizontal: value });
	}
	get layoutSizingVertical(): unknown {
		return this.read('layoutSizingVertical');
	}
	set layoutSizingVertical(value: unknown) {
		this.set({ layoutSizingVertical: value });
	}
	get layoutPositioning(): unknown {
		return this.read('layoutPositioning');
	}
	set layoutPositioning(value: unknown) {
		this.set({ layoutPositioning: value });
	}

	// ---------- geometry ----------

	private get transform(): [[number, number, number], [number, number, number]] {
		return this.read<[[number, number, number], [number, number, number]]>('transform');
	}

	get x(): number {
		return this.transform[0][2];
	}
	set x(value: number) {
		this.set({ x: value });
	}
	get y(): number {
		return this.transform[1][2];
	}
	set y(value: number) {
		this.set({ y: value });
	}
	get rotation(): number {
		const matrix = this.transform;
		return (Math.atan2(matrix[1][0], matrix[0][0]) * 180) / Math.PI;
	}
	set rotation(value: number) {
		this.set({ rotation: value });
	}
	get width(): number {
		return this.read<number>('width');
	}
	get height(): number {
		return this.read<number>('height');
	}

	resize(width: number, height: number): void {
		this.set({ width, height });
	}

	resizeWithoutConstraints(width: number, height: number): void {
		this.set({ width, height });
	}

	// ---------- paints ----------

	get fills(): readonly Paint[] {
		const node = this.node;
		if (node.type === 'TEXT') return clone(node.defaultStyle.fills);
		return clone(this.read<Paint[]>('fills'));
	}
	set fills(paints: readonly unknown[]) {
		if (!Array.isArray(paints)) throw new FigmaCompatError('fills must be an array of paints');
		const solids = paints.map((paint) => solidOf(paint, 'fills'));
		if (this.node.type === 'TEXT') {
			if (solids.length !== 1) {
				throw new FigmaCompatError(
					unsupportedMessage(
						'fills of a text layer other than one SOLID paint',
						'text has one color'
					)
				);
			}
			this.set({ textColor: solids[0] });
			return;
		}
		this.set({ fills: solids });
	}

	get strokes(): readonly Paint[] {
		const strokes = this.read<{ paints: Paint[] }[] | undefined>('strokes');
		if (strokes === undefined) return [];
		return clone(strokes.flatMap((stroke) => stroke.paints));
	}
	set strokes(paints: readonly unknown[]) {
		if (!Array.isArray(paints)) throw new FigmaCompatError('strokes must be an array of paints');
		if (paints.length === 0) {
			this.set({ stroke: null });
			return;
		}
		if (paints.length > 1) {
			throw new FigmaCompatError(
				unsupportedMessage('more than one stroke paint', 'a layer has one stroke here')
			);
		}
		const solid = solidOf(paints[0], 'strokes');
		this.set({ stroke: solid, strokeWeight: this.strokeWeight || 1 });
	}

	get strokeWeight(): number {
		const strokes = this.read<{ weight: number }[] | undefined>('strokes');
		if (strokes === undefined || strokes.length === 0) return 0;
		return strokes[0].weight;
	}
	set strokeWeight(value: number) {
		const strokes = this.read<{ paints: Paint[] }[] | undefined>('strokes');
		if (strokes === undefined || strokes.length === 0) {
			throw new FigmaCompatError('Set strokes before strokeWeight');
		}
		const solid = solidOf(strokes[0].paints[0], 'strokes');
		this.set({ stroke: solid, strokeWeight: value });
	}

	get cornerRadius(): number | typeof FIGMA_MIXED {
		const radius = this.read<number | number[] | undefined>('cornerRadius');
		if (radius === undefined) return 0;
		if (typeof radius === 'number') return radius;
		return FIGMA_MIXED;
	}
	set cornerRadius(value: number) {
		this.set({ cornerRadius: value });
	}

	// ---------- text ----------

	get characters(): string | undefined {
		const node = this.node;
		if (node.type !== 'TEXT') return undefined;
		return node.paragraphs
			.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
			.join('\n');
	}
	set characters(value: string) {
		this.requireText('characters');
		this.set({ characters: value });
	}

	get fontSize(): number | undefined {
		const node = this.node;
		if (node.type !== 'TEXT') return undefined;
		return node.defaultStyle.fontSize;
	}
	set fontSize(value: number) {
		this.requireText('fontSize');
		this.set({ fontSize: value });
	}

	get fontName(): { family: string; style: string } | undefined {
		const node = this.node;
		if (node.type !== 'TEXT') return undefined;
		return clone(node.defaultStyle.fontName);
	}
	set fontName(value: { family: string; style: string }) {
		this.requireText('fontName');
		this.set({ fontName: value });
	}

	private requireText(property: string): void {
		if (this.node.type !== 'TEXT') {
			throw new FigmaCompatError(`${property} can only be set on a text layer`);
		}
	}

	// ---------- tree ----------

	private get isContainer(): boolean {
		return CONTAINER_TYPES.includes(this.node.type);
	}

	get children(): readonly FigmaNode[] | undefined {
		if (!this.isContainer) return undefined;
		return this.mirror.childIds(this.id).map((childId) => this.host.wrap(childId));
	}

	appendChild(child: FigmaNode): void {
		this.requireContainer();
		this.mirror.move(child.id, this.id);
	}

	insertChild(index: number, child: FigmaNode): void {
		this.requireContainer();
		this.mirror.move(child.id, this.id, index);
	}

	private requireContainer(): void {
		if (!this.isContainer) {
			throw new FigmaCompatError(`A ${this.node.type} layer cannot have children`);
		}
	}

	findAll(predicate?: Predicate): FigmaNode[] {
		this.requireContainer();
		const found: FigmaNode[] = [];
		for (const id of this.mirror.subtree(this.id).slice(1)) {
			const wrapper = this.host.wrap(id);
			if (predicate === undefined || predicate(wrapper)) found.push(wrapper);
		}
		return found;
	}

	findOne(predicate: Predicate): FigmaNode | null {
		const [first] = this.findAll(predicate);
		if (first === undefined) return null;
		return first;
	}

	findChildren(predicate?: Predicate): FigmaNode[] {
		this.requireContainer();
		return this.mirror
			.childIds(this.id)
			.map((childId) => this.host.wrap(childId))
			.filter((child) => predicate === undefined || predicate(child));
	}

	findChild(predicate: Predicate): FigmaNode | null {
		const [first] = this.findChildren(predicate);
		if (first === undefined) return null;
		return first;
	}

	// ---------- page ----------

	get selection(): readonly FigmaNode[] | undefined {
		if (this.node.type !== 'PAGE') return undefined;
		return this.mirror.selection.map((selectedId) => this.host.wrap(selectedId));
	}
	set selection(nodes: readonly FigmaNode[]) {
		if (this.node.type !== 'PAGE') {
			throw new FigmaCompatError('selection can only be set on a page');
		}
		this.mirror.setSelection(nodes.map((node) => node.id));
	}

	// ---------- lifecycle ----------

	remove(): void {
		this.mirror.remove(this.id);
	}

	clone(): FigmaNode {
		const source = this.node;
		if (source.type === 'PAGE') throw new FigmaCompatError('A page cannot be cloned');
		const parentId = source.parentId;
		if (parentId === null) throw new FigmaCompatError('A node without a parent cannot be cloned');
		const created = this.cloneInto(this.id, parentId);
		return this.host.wrap(created.id);
	}

	private cloneInto(sourceId: string, parentId: string): Node {
		const source = this.mirror.requireNode(sourceId);
		const copy = this.mirror.create(source.type, parentId, cloneProps(source));
		for (const childId of this.mirror.childIds(sourceId)) this.cloneInto(childId, copy.id);
		return copy;
	}

	// ---------- plugin data ----------

	getPluginData(key: string): string {
		return this.mirror.readData(this.host.pluginId, this.id, key);
	}
	setPluginData(key: string, value: string): void {
		this.mirror.writeData(this.host.pluginId, this.id, key, value);
	}
	getPluginDataKeys(): string[] {
		const own = this.node.pluginData[`plugin:${this.host.pluginId}`];
		if (own === undefined) return [];
		return Object.keys(own).filter((key) => key !== 'relaunchData');
	}
	getSharedPluginData(namespace: string, key: string): string {
		return this.mirror.readSharedData(this.id, namespace, key);
	}
	setSharedPluginData(namespace: string, key: string, value: string): void {
		this.mirror.writeSharedData(this.id, namespace, key, value);
	}
	getSharedPluginDataKeys(namespace: string): string[] {
		const shared = this.node.pluginData[`shared:${namespace}`];
		if (shared === undefined) return [];
		return Object.keys(shared);
	}
	setRelaunchData(data: Record<string, string>): void {
		this.mirror.writeRelaunchData(this.host.pluginId, this.id, data);
	}
	getRelaunchData(): Record<string, string> {
		return {};
	}

	/** What `JSON.stringify` and the console show. */
	toJSON(): { id: string; type: string; name: string } {
		return { id: this.id, type: this.type, name: this.name };
	}
}

/** The props that recreate `source` through the Figma vocabulary. */
function cloneProps(source: Node): Record<string, unknown> {
	const props: Record<string, unknown> = { name: source.name };
	for (const key of DIRECT_PROPERTIES) {
		const value: unknown = Reflect.get(source, key);
		if (value !== undefined && key !== 'name') props[key] = value;
	}
	if ('transform' in source) {
		props.x = source.transform[0][2];
		props.y = source.transform[1][2];
	}
	if ('width' in source) {
		props.width = source.width;
		props.height = source.height;
	}
	if (source.type === 'TEXT') {
		props.characters = source.paragraphs
			.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
			.join('\n');
		props.fontSize = source.defaultStyle.fontSize;
		props.fontName = source.defaultStyle.fontName;
	}
	return props;
}

/** Wrap a node object so members the layer does not support throw instead of reading as `undefined`. */
export function guardNode(node: FigmaNode): FigmaNode {
	return new Proxy(node, {
		get(target, property, receiver) {
			if (typeof property === 'string' && Object.hasOwn(UNSUPPORTED_NODE_MEMBERS, property)) {
				throw new FigmaCompatError(
					unsupportedMessage(`node.${property}`, UNSUPPORTED_NODE_MEMBERS[property])
				);
			}
			return Reflect.get(target, property, receiver);
		},
		set(target, property, value, receiver) {
			if (typeof property === 'string' && Object.hasOwn(UNSUPPORTED_NODE_MEMBERS, property)) {
				throw new FigmaCompatError(
					unsupportedMessage(`node.${property}`, UNSUPPORTED_NODE_MEMBERS[property])
				);
			}
			return Reflect.set(target, property, value, receiver);
		}
	});
}
