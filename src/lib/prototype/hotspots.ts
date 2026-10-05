// Hotspots: the areas of a frame that react to input in the player. Every visible node below a
// frame (and the frame itself) with at least one interaction becomes one, positioned relative to
// the frame. Deeper nodes come later so they sit on top.

import type { DocumentReader, Node, NodeId, Rect } from '../document';
import { reactionsOf, triggerKind, type TriggerKind } from './model';

export interface Hotspot {
	nodeId: NodeId;
	/** Relative to the frame's top-left corner. */
	rect: Rect;
	depth: number;
	/** Inside a fixed child of a scrolling frame: stays put while the content scrolls. */
	fixed: boolean;
	triggers: TriggerKind[];
	/** Delays in seconds of the AFTER_TIMEOUT reactions. */
	timeouts: number[];
}

function timeoutsOf(node: Node): number[] {
	const seconds: number[] = [];
	for (const reaction of reactionsOf(node)) {
		const trigger = reaction.trigger;
		if (trigger !== null && trigger.type === 'AFTER_TIMEOUT') seconds.push(trigger.timeout);
	}
	return seconds;
}

function depthBelow(reader: DocumentReader, frameId: NodeId, nodeId: NodeId): number {
	let depth = 0;
	let current = reader.getNode(nodeId);
	while (current !== undefined && current.id !== frameId) {
		depth += 1;
		if (current.parentId === null) return depth;
		current = reader.getNode(current.parentId);
	}
	return depth;
}

function isVisible(reader: DocumentReader, frameId: NodeId, nodeId: NodeId): boolean {
	const chain = [reader.requireNode(nodeId), ...reader.ancestors(nodeId)];
	for (const node of chain) {
		if ('visible' in node && !node.visible) return false;
		if (node.id === frameId) return true;
	}
	return true;
}

/** The ids of the frame's fixed children (the last `numberOfFixedChildren` ones). */
export function fixedChildIds(reader: DocumentReader, frameId: NodeId): Set<NodeId> {
	const frame = reader.requireNode(frameId);
	if (frame.type !== 'FRAME') return new Set();
	const count = frame.numberOfFixedChildren;
	if (count <= 0) return new Set();
	return new Set(reader.children(frameId).slice(-count));
}

export function hotspotsOf(
	reader: DocumentReader,
	frameId: NodeId,
	boundsOf: (id: NodeId) => Rect
): Hotspot[] {
	const origin = boundsOf(frameId);
	const fixedIds = fixedChildIds(reader, frameId);
	const nodes = [reader.requireNode(frameId), ...reader.descendants(frameId)];
	const hotspots: Hotspot[] = [];
	for (const node of nodes) {
		if (reactionsOf(node).length === 0) continue;
		if (!isVisible(reader, frameId, node.id)) continue;
		const bounds = boundsOf(node.id);
		const topChild = [node, ...reader.ancestors(node.id)].find((candidate) =>
			fixedIds.has(candidate.id)
		);
		hotspots.push({
			nodeId: node.id,
			rect: {
				x: bounds.x - origin.x,
				y: bounds.y - origin.y,
				width: bounds.width,
				height: bounds.height
			},
			depth: depthBelow(reader, frameId, node.id),
			fixed: topChild !== undefined,
			triggers: reactionsOf(node).map((reaction) => triggerKind(reaction.trigger)),
			timeouts: timeoutsOf(node)
		});
	}
	return hotspots.sort((a, b) => a.depth - b.depth);
}
