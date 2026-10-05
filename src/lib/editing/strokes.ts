// Stroke edits for the Design panel. A node can hold several strokes; the panel edits the first
// (the one Figma shows) and leaves the others alone. Pure.

import type { Paint, Stroke, StrokeWeights } from '../document/types';
import { defaultStroke } from './paints';

export type StrokeCap = Stroke['cap'];

/** Apply `change` to the first stroke, creating a default stroke when there is none. */
export function changeFirstStroke(
	strokes: readonly Stroke[],
	change: (stroke: Stroke) => Stroke
): Stroke[] {
	const [first, ...others] = strokes;
	if (first === undefined) return [change(defaultStroke([]))];
	return [change(first), ...others];
}

/** Edit the first stroke's paints; a stroke left without paints is removed. */
export function changeStrokePaints(
	strokes: readonly Stroke[],
	update: (paints: Paint[]) => Paint[]
): Stroke[] {
	const next = changeFirstStroke(strokes, (stroke) => ({
		...stroke,
		paints: update(stroke.paints)
	}));
	const [first, ...others] = next;
	if (first.paints.length > 0) return next;
	return others;
}

export function isPerSide(weight: Stroke['weight']): weight is StrokeWeights {
	return typeof weight !== 'number';
}

export function uniformWeight(weight: Stroke['weight']): number {
	if (typeof weight === 'number') return weight;
	return Math.max(weight.top, weight.right, weight.bottom, weight.left);
}

export function perSideWeights(weight: Stroke['weight']): StrokeWeights {
	if (typeof weight !== 'number') return weight;
	return { top: weight, right: weight, bottom: weight, left: weight };
}

export type SideName = keyof StrokeWeights;

export function withSideWeight(
	weight: Stroke['weight'],
	side: SideName,
	value: number
): StrokeWeights {
	return { ...perSideWeights(weight), [side]: value };
}

const DEFAULT_DASH = 10;

/** The dash and gap lengths of a pattern; both zero for a solid line. */
export function dashAndGap(pattern: readonly number[]): { dash: number; gap: number } {
	if (pattern.length === 0) return { dash: 0, gap: 0 };
	const [dash, gap] = pattern;
	if (gap === undefined) return { dash, gap: dash };
	return { dash, gap };
}

export function dashedPattern(dash: number, gap: number): number[] {
	return [dash, gap];
}

export function defaultDashPattern(): number[] {
	return [DEFAULT_DASH, DEFAULT_DASH];
}
