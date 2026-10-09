import type { Lab, NodeState, Sample } from '../lab';

// Far from the fixture's other nodes, so no edge or center can snap unless an experiment puts one there.
export const ISOLATED = { x: 2000, y: 2000 };

export async function placeNode(lab: Lab, name: string, x: number, y: number): Promise<void> {
	await lab.placeNode(name, x, y);
}

/** A alone at ISOLATED, viewed at `zoom` around its center, nothing selected. */
export async function isolateA(lab: Lab, zoom = 1): Promise<void> {
	await placeNode(lab, 'A', ISOLATED.x, ISOLATED.y);
	await lab.setZoom(zoom, { x: ISOLATED.x + 50, y: ISOLATED.y + 50 });
	await lab.tap('Escape');
}

export function selected(sample: Sample, name: string): NodeState | null {
	const node = sample.selection.find((candidate) => candidate.name === name);
	if (!node) return null;
	return node;
}

/** "Δ+20,+0" relative to an origin, or "not selected". */
export function offsetOf(sample: Sample, name: string, origin: { x: number; y: number }): string {
	const node = selected(sample, name);
	if (!node || !node.absolute) return `${name} not selected`;
	return `Δ${signed(node.absolute.x - origin.x)},${signed(node.absolute.y - origin.y)}`;
}

export function signed(value: number): string {
	const rounded = Math.round(value * 100) / 100;
	if (rounded >= 0) return `+${rounded}`;
	return String(rounded);
}

export async function pageChildCount(lab: Lab): Promise<number> {
	const children = await lab.pageChildren();
	return children.length;
}
