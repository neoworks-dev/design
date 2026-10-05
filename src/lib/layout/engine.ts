// The auto layout engine: stacks with gap, padding, alignment, wrap, space between, hug / fill /
// fixed sizing, min / max and absolutely positioned children. Pure: plain values in, plain values
// out, no kernel, no Svelte, no Skia (text is measured through an injected function on the item).
//
// Sizes are resolved in two directions at once, per container:
//   bottom-up  a hugging container sums its children's natural sizes; a child that fills is
//              measured like a hug child here, so a hugging parent never waits on its own child
//   top-down   a container with a known size splits the free space between its fill children
//              (equally, within each child's min / max) and stretches fill children across the line
// `place(item, assignedX, assignedY)` is that recursion: the parent assigns a size on an axis it
// controls, otherwise the item's own mode decides. Results are memoised per assignment, so a
// subtree is laid out a constant number of times however deep it nests.
//
// Layout of the item's box uses the item's size; strokes count only through `strokeInsets`
// (supplied when the parent includes strokes in the layout).

import type { LayoutResult } from '../document/derived';
import type { NodeId } from '../document/types';
import type {
	Axis,
	ContainerSettings,
	Insets,
	LayoutContainer,
	LayoutItem,
	LayoutLeaf,
	Sizing
} from './types';

interface Placed {
	width: number;
	height: number;
	kids: PlacedKid[];
}

interface PlacedKid {
	item: LayoutItem;
	x: number;
	y: number;
	placed: Placed;
}

interface Assigned {
	x: number | null;
	y: number | null;
}

type AxisMode = 'assigned' | 'hug' | 'fixed';

interface SizeBounds {
	min: number;
	max: number;
}

const PRECISION = 10_000;

/** Positions and sizes of the root and every item below it. The root's x and y are echoed. */
export function computeLayout(root: LayoutContainer): Map<NodeId, LayoutResult> {
	const layouter = new Layouter();
	const placed = layouter.place(root, { x: null, y: null }, false);
	const results = new Map<NodeId, LayoutResult>();
	record(results, root, root.x, root.y, placed);
	return results;
}

function record(
	results: Map<NodeId, LayoutResult>,
	item: LayoutItem,
	x: number,
	y: number,
	placed: Placed
): void {
	results.set(item.id, {
		nodeId: item.id,
		x: round(x),
		y: round(y),
		width: round(placed.width),
		height: round(placed.height)
	});
	for (const kid of placed.kids) record(results, kid.item, kid.x, kid.y, kid.placed);
}

function round(value: number): number {
	return Math.round(value * PRECISION) / PRECISION;
}

// ---------- per-axis accessors ----------

function sizeOf(item: LayoutItem, axis: Axis): number {
	if (axis === 'x') return item.width;
	return item.height;
}

function sizingOf(item: LayoutItem, axis: Axis): Sizing {
	if (axis === 'x') return item.sizingHorizontal;
	return item.sizingVertical;
}

function minOf(item: LayoutItem, axis: Axis): number | null {
	if (axis === 'x') return item.minWidth;
	return item.minHeight;
}

function maxOf(item: LayoutItem, axis: Axis): number | null {
	if (axis === 'x') return item.maxWidth;
	return item.maxHeight;
}

function startInset(insets: Insets, axis: Axis): number {
	if (axis === 'x') return insets.left;
	return insets.top;
}

function endInset(insets: Insets, axis: Axis): number {
	if (axis === 'x') return insets.right;
	return insets.bottom;
}

function totalInset(insets: Insets, axis: Axis): number {
	return startInset(insets, axis) + endInset(insets, axis);
}

function clamp(item: LayoutItem, axis: Axis, value: number): number {
	let result = value;
	const max = maxOf(item, axis);
	if (max !== null) result = Math.min(result, max);
	const min = minOf(item, axis);
	if (min !== null) result = Math.max(result, min);
	return Math.max(0, result);
}

function otherAxis(axis: Axis): Axis {
	if (axis === 'x') return 'y';
	return 'x';
}

function axisMode(item: LayoutItem, axis: Axis, assigned: Assigned, fillAsHug: boolean): AxisMode {
	if (assigned[axis] !== null) return 'assigned';
	const sizing = sizingOf(item, axis);
	if (sizing === 'HUG') return 'hug';
	if (sizing === 'FILL' && fillAsHug) return 'hug';
	return 'fixed';
}

/** Split `free` equally between the bounded shares; a share that hits a bound is fixed there. */
export function distribute(free: number, bounds: SizeBounds[]): number[] {
	const result = bounds.map(() => 0);
	let active = bounds.map((_, index) => index);
	let remaining = free;
	while (active.length > 0) {
		const share = remaining / active.length;
		const belowMin = active.filter((index) => share < bounds[index].min);
		if (belowMin.length > 0) {
			for (const index of belowMin) {
				result[index] = bounds[index].min;
				remaining -= bounds[index].min;
			}
			active = active.filter((index) => !belowMin.includes(index));
			continue;
		}
		const aboveMax = active.filter((index) => share > bounds[index].max);
		if (aboveMax.length > 0) {
			for (const index of aboveMax) {
				result[index] = bounds[index].max;
				remaining -= bounds[index].max;
			}
			active = active.filter((index) => !aboveMax.includes(index));
			continue;
		}
		for (const index of active) result[index] = share;
		break;
	}
	return result;
}

/** Greedy line breaking: a line takes items while they fit (the first item always stays). */
export function breakLines(sizes: number[], limit: number, gap: number): number[][] {
	const lines: number[][] = [];
	let current: number[] = [];
	let used = 0;
	sizes.forEach((size, index) => {
		const needed = current.length === 0 ? size : used + gap + size;
		if (current.length > 0 && needed > limit) {
			lines.push(current);
			current = [];
		}
		used = current.length === 0 ? size : used + gap + size;
		current.push(index);
	});
	if (current.length > 0) lines.push(current);
	return lines;
}

// ---------- the recursion ----------

class Layouter {
	private readonly memo = new Map<LayoutItem, Map<string, Placed>>();

	place(item: LayoutItem, assigned: Assigned, fillAsHug: boolean): Placed {
		const key = `${assigned.x}|${assigned.y}|${fillAsHug}`;
		let byKey = this.memo.get(item);
		if (byKey === undefined) {
			byKey = new Map();
			this.memo.set(item, byKey);
		}
		const cached = byKey.get(key);
		if (cached !== undefined) return cached;
		const placed =
			item.kind === 'leaf'
				? this.placeLeaf(item, assigned, fillAsHug)
				: this.placeContainer(item, assigned, fillAsHug);
		byKey.set(key, placed);
		return placed;
	}

	private placeLeaf(leaf: LayoutLeaf, assigned: Assigned, fillAsHug: boolean): Placed {
		const modeX = axisMode(leaf, 'x', assigned, fillAsHug);
		const modeY = axisMode(leaf, 'y', assigned, fillAsHug);
		const measure = leaf.measureText;
		let width = leaf.width;
		if (assigned.x !== null) width = assigned.x;
		else if (modeX === 'hug' && measure !== undefined) width = measure(null).width;
		width = clamp(leaf, 'x', width);
		let height = leaf.height;
		if (assigned.y !== null) height = assigned.y;
		else if (modeY === 'hug' && measure !== undefined) height = measure(width).height;
		height = clamp(leaf, 'y', height);
		return { width, height, kids: [] };
	}

	private placeContainer(
		container: LayoutContainer,
		assigned: Assigned,
		fillAsHug: boolean
	): Placed {
		const settings = container.settings;
		const primary: Axis = settings.mode === 'HORIZONTAL' ? 'x' : 'y';
		const counter = otherAxis(primary);
		const flow = container.children.filter((child) => child.positioning !== 'ABSOLUTE');
		const modes = {
			x: axisMode(container, 'x', assigned, fillAsHug),
			y: axisMode(container, 'y', assigned, fillAsHug)
		};
		const padding = settings.padding;
		const paddingPrimary = totalInset(padding, primary);
		const paddingCounter = totalInset(padding, counter);
		const gap = settings.itemSpacing;
		const strokeOuter = (child: LayoutItem, axis: Axis): number =>
			totalInset(child.strokeInsets, axis);

		// A fill child on a known counter axis already knows that size (text wraps against it).
		const fixedCounter = this.fixedSize(container, counter, assigned);
		const knownCounter = (child: LayoutItem): number | null => {
			if (settings.wrap || modes[counter] === 'hug') return null;
			if (sizingOf(child, counter) !== 'FILL') return null;
			return Math.max(0, fixedCounter - paddingCounter - strokeOuter(child, counter));
		};

		// Natural outer sizes: fill children count like hug children.
		const natural = flow.map((child) => {
			const placed = this.place(child, assign(primary, null, knownCounter(child)), true);
			return {
				x: placed.width + strokeOuter(child, 'x'),
				y: placed.height + strokeOuter(child, 'y')
			};
		});

		// Primary axis: line breaking, container size, flex.
		const fixedPrimary = this.fixedSize(container, primary, assigned);
		let lineLimit = Infinity;
		if (modes[primary] !== 'hug') lineLimit = fixedPrimary - paddingPrimary;
		else if (settings.wrap) lineLimit = this.hugLimit(container, primary, paddingPrimary);
		let lines = [flow.map((_, index) => index)];
		if (settings.wrap) {
			lines = breakLines(
				natural.map((size) => size[primary]),
				lineLimit,
				gap
			);
		}
		if (flow.length === 0) lines = [];
		const contentPrimary = Math.max(
			0,
			...lines.map((line) => lineLength(line, natural, primary, gap))
		);
		let primarySize = fixedPrimary;
		if (modes[primary] === 'hug') {
			primarySize = clamp(container, primary, contentPrimary + paddingPrimary);
		}
		const innerPrimary = primarySize - paddingPrimary;

		const primaryOuter = natural.map((size) => size[primary]);
		if (modes[primary] !== 'hug') {
			for (const line of lines) {
				this.flexLine(line, flow, primaryOuter, primary, innerPrimary, gap);
			}
		}

		// Counter axis: natural line thickness with the final primary sizes, container size.
		const primaryAssignment = (index: number): number | null => {
			if (modes[primary] === 'hug') return null;
			if (sizingOf(flow[index], primary) !== 'FILL') return null;
			return primaryOuter[index] - strokeOuter(flow[index], primary);
		};
		const counterNatural = flow.map((child, index) => {
			const placed = this.place(
				child,
				assign(primary, primaryAssignment(index), knownCounter(child)),
				true
			);
			return placed[axisSize(counter)] + strokeOuter(child, counter);
		});
		const lineThickness = lines.map((line) => Math.max(0, ...line.map((i) => counterNatural[i])));
		const counterGap = this.counterGap(settings);
		const contentCounter =
			lineThickness.reduce((total, value) => total + value, 0) +
			counterGap * Math.max(0, lines.length - 1);
		let counterSize = fixedCounter;
		if (modes[counter] === 'hug') {
			counterSize = clamp(container, counter, contentCounter + paddingCounter);
		}
		const innerCounter = Math.max(0, counterSize - paddingCounter);
		if (!settings.wrap && lines.length === 1) lineThickness[0] = innerCounter;
		let lineGap = counterGap;
		if (this.spreadsLines(settings, lines.length, modes[counter])) {
			const used = lineThickness.reduce((total, value) => total + value, 0);
			lineGap = Math.max(counterGap, (innerCounter - used) / (lines.length - 1));
		}

		// Final placement.
		const kids: Array<PlacedKid | undefined> = Array.from({ length: flow.length });
		let lineStart = startInset(padding, counter);
		lines.forEach((line, lineIndex) => {
			const thickness = lineThickness[lineIndex];
			const spacing = this.lineSpacing(settings, line, primaryOuter, innerPrimary);
			let cursor = startInset(padding, primary) + spacing.offset;
			for (const index of line) {
				const child = flow[index];
				const placed = this.place(
					child,
					assign(
						primary,
						primaryAssignment(index),
						sizingOf(child, counter) === 'FILL'
							? Math.max(0, thickness - strokeOuter(child, counter))
							: null
					),
					true
				);
				const outerCounter = placed[axisSize(counter)] + strokeOuter(child, counter);
				const along = lineStart + counterOffset(settings.counterAlign, thickness, outerCounter);
				const position = { x: 0, y: 0 };
				position[primary] = cursor + startInset(child.strokeInsets, primary);
				position[counter] = along + startInset(child.strokeInsets, counter);
				kids[index] = { item: child, x: position.x, y: position.y, placed };
				cursor += primaryOuter[index] + spacing.gap;
			}
			lineStart += thickness + lineGap;
		});

		const result: Placed = { width: 0, height: 0, kids: [] };
		result[axisSize(primary)] = primarySize;
		result[axisSize(counter)] = counterSize;
		result.kids = kids.filter((kid): kid is PlacedKid => kid !== undefined);
		for (const child of container.children) {
			if (child.positioning !== 'ABSOLUTE') continue;
			const placed = this.place(child, { x: null, y: null }, false);
			result.kids.push({ item: child, x: child.x, y: child.y, placed });
		}
		return result;
	}

	/** Size on `axis` when the container does not hug: assigned by the parent, else its own. */
	private fixedSize(container: LayoutContainer, axis: Axis, assigned: Assigned): number {
		const forced = assigned[axis];
		if (forced !== null) return clamp(container, axis, forced);
		return clamp(container, axis, sizeOf(container, axis));
	}

	/** Where a wrapping, hugging container breaks lines: at its max size, never otherwise. */
	private hugLimit(container: LayoutContainer, axis: Axis, padding: number): number {
		const max = maxOf(container, axis);
		if (max === null) return Infinity;
		return max - padding;
	}

	private counterGap(settings: ContainerSettings): number {
		if (settings.counterSpacing === null) return settings.itemSpacing;
		return settings.counterSpacing;
	}

	private spreadsLines(settings: ContainerSettings, lineCount: number, mode: AxisMode): boolean {
		if (!settings.wrap || lineCount < 2) return false;
		if (mode === 'hug') return false;
		return settings.counterContentAlign === 'SPACE_BETWEEN';
	}

	/** Give the fill children of one line their share of the space the others leave. */
	private flexLine(
		line: number[],
		flow: LayoutItem[],
		primaryOuter: number[],
		primary: Axis,
		innerPrimary: number,
		gap: number
	): void {
		const fills = line.filter((index) => sizingOf(flow[index], primary) === 'FILL');
		if (fills.length === 0) return;
		const others = line.filter((index) => !fills.includes(index));
		const used =
			others.reduce((total, index) => total + primaryOuter[index], 0) +
			gap * Math.max(0, line.length - 1);
		const bounds = fills.map((index) => {
			const child = flow[index];
			const outer = totalInset(child.strokeInsets, primary);
			const max = maxOf(child, primary);
			return {
				min: (minOf(child, primary) ?? 0) + outer,
				max: max === null ? Infinity : max + outer
			};
		});
		const shares = distribute(Math.max(0, innerPrimary - used), bounds);
		fills.forEach((index, position) => {
			primaryOuter[index] = shares[position];
		});
	}

	/** Start offset and gap between the items of a line for the primary alignment. */
	private lineSpacing(
		settings: ContainerSettings,
		line: number[],
		primaryOuter: number[],
		innerPrimary: number
	): { offset: number; gap: number } {
		const gap = settings.itemSpacing;
		const sizes = line.reduce((total, index) => total + primaryOuter[index], 0);
		const free = innerPrimary - sizes - gap * Math.max(0, line.length - 1);
		if (settings.primaryAlign === 'CENTER') return { offset: free / 2, gap };
		if (settings.primaryAlign === 'MAX') return { offset: free, gap };
		if (settings.primaryAlign !== 'SPACE_BETWEEN') return { offset: 0, gap };
		if (line.length < 2 || free <= 0) return { offset: 0, gap };
		return { offset: 0, gap: (innerPrimary - sizes) / (line.length - 1) };
	}
}

function assign(primary: Axis, primaryValue: number | null, counterValue: number | null): Assigned {
	if (primary === 'x') return { x: primaryValue, y: counterValue };
	return { x: counterValue, y: primaryValue };
}

function axisSize(axis: Axis): 'width' | 'height' {
	if (axis === 'x') return 'width';
	return 'height';
}

function lineLength(
	line: number[],
	natural: Array<Record<Axis, number>>,
	primary: Axis,
	gap: number
): number {
	const sizes = line.reduce((total, index) => total + natural[index][primary], 0);
	return sizes + gap * Math.max(0, line.length - 1);
}

function counterOffset(
	align: ContainerSettings['counterAlign'],
	thickness: number,
	outer: number
): number {
	if (align === 'CENTER') return (thickness - outer) / 2;
	if (align === 'MAX') return thickness - outer;
	return 0;
}
