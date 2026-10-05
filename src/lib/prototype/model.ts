// Prototype data (data-model.md "Prototyping"): interactions are `reactions` on a node, flow
// starting points live on the page node, the device preset in the page's `pluginData`. Everything
// here is pure: it reads a DocumentReader and returns change sets for `document.apply`.

import {
	planSetProps,
	type Action,
	type Change,
	type DocumentReader,
	type Node,
	type NodeId,
	type PageNode,
	type Reaction,
	type Transition,
	type Trigger
} from '../document';

export type TriggerKind =
	'ON_CLICK' | 'ON_HOVER' | 'ON_PRESS' | 'ON_DRAG' | 'AFTER_TIMEOUT' | 'ON_KEY_DOWN';

export const TRIGGER_LABELS: Record<TriggerKind, string> = {
	ON_CLICK: 'On click',
	ON_HOVER: 'While hovering',
	ON_PRESS: 'While pressing',
	ON_DRAG: 'On drag',
	AFTER_TIMEOUT: 'After delay',
	ON_KEY_DOWN: 'On key press'
};

export type ActionKind = 'NAVIGATE' | 'BACK' | 'OVERLAY' | 'SWAP' | 'CLOSE' | 'SCROLL_TO' | 'URL';

export const ACTION_LABELS: Record<ActionKind, string> = {
	NAVIGATE: 'Navigate to',
	BACK: 'Back',
	OVERLAY: 'Open overlay',
	SWAP: 'Swap overlay',
	CLOSE: 'Close overlay',
	SCROLL_TO: 'Scroll to',
	URL: 'Open link'
};

export type TransitionKind = 'INSTANT' | Transition['type'];

export const TRANSITION_LABELS: Record<TransitionKind, string> = {
	INSTANT: 'Instant',
	DISSOLVE: 'Dissolve',
	SMART_ANIMATE: 'Smart animate',
	SCROLL_ANIMATE: 'Scroll animate',
	MOVE_IN: 'Move in',
	MOVE_OUT: 'Move out',
	PUSH: 'Push',
	SLIDE_IN: 'Slide in',
	SLIDE_OUT: 'Slide out'
};

export const DIRECTIONAL_TRANSITIONS: readonly TransitionKind[] = [
	'MOVE_IN',
	'MOVE_OUT',
	'PUSH',
	'SLIDE_IN',
	'SLIDE_OUT'
];

export const EASING_LABELS: Record<string, string> = {
	LINEAR: 'Linear',
	EASE_IN: 'Ease in',
	EASE_OUT: 'Ease out',
	EASE_IN_AND_OUT: 'Ease in and out'
};

/** Durations and delays are stored in seconds, like Figma's plugin API. */
export const DEFAULT_TRANSITION_SECONDS = 0.3;
export const DEFAULT_TIMEOUT_SECONDS = 0.8;
export const DEFAULT_KEY_CODE = 32;

/** Frames and shapes carry reactions; pages and slices do not. */
export function reactionsOf(node: Node): readonly Reaction[] {
	if (!('reactions' in node)) return [];
	return node.reactions;
}

export function triggerKind(trigger: Trigger | null): TriggerKind {
	if (trigger === null) return 'ON_CLICK';
	return trigger.type;
}

export function actionKind(action: Action | undefined): ActionKind {
	if (action === undefined) return 'NAVIGATE';
	if (action.type === 'BACK' || action.type === 'CLOSE' || action.type === 'URL')
		return action.type;
	if (action.type !== 'NODE') return 'NAVIGATE';
	if (action.navigation === 'OVERLAY') return 'OVERLAY';
	if (action.navigation === 'SWAP') return 'SWAP';
	if (action.navigation === 'SCROLL_TO') return 'SCROLL_TO';
	return 'NAVIGATE';
}

export function triggerOfKind(kind: TriggerKind, previous: Trigger | null): Trigger {
	if (kind === 'AFTER_TIMEOUT') {
		if (previous !== null && previous.type === 'AFTER_TIMEOUT') return previous;
		return { type: 'AFTER_TIMEOUT', timeout: DEFAULT_TIMEOUT_SECONDS };
	}
	if (kind === 'ON_KEY_DOWN') {
		if (previous !== null && previous.type === 'ON_KEY_DOWN') return previous;
		return { type: 'ON_KEY_DOWN', device: 'KEYBOARD', keyCodes: [DEFAULT_KEY_CODE] };
	}
	return { type: kind };
}

function destinationOf(action: Action | undefined): NodeId | null {
	if (action === undefined || action.type !== 'NODE') return null;
	return action.destinationId;
}

function transitionOf(action: Action | undefined): Transition | undefined {
	if (action === undefined || action.type !== 'NODE') return undefined;
	return action.transition;
}

export function actionOfKind(kind: ActionKind, previous: Action | undefined): Action {
	if (kind === 'BACK' || kind === 'CLOSE') return { type: kind };
	if (kind === 'URL') {
		if (previous !== undefined && previous.type === 'URL') return previous;
		return { type: 'URL', url: 'https://', openInNewTab: true };
	}
	const destinationId = destinationOf(previous);
	if (kind === 'SCROLL_TO') return { type: 'NODE', destinationId, navigation: 'SCROLL_TO' };
	const transition = transitionOf(previous);
	return { type: 'NODE', destinationId, navigation: kind, transition };
}

export function transitionKind(transition: Transition | undefined): TransitionKind {
	if (transition === undefined) return 'INSTANT';
	return transition.type;
}

export function transitionOfKind(
	kind: TransitionKind,
	previous: Transition | undefined
): Transition | undefined {
	if (kind === 'INSTANT') return undefined;
	let direction: Transition['direction'];
	if (DIRECTIONAL_TRANSITIONS.includes(kind)) direction = 'LEFT';
	if (previous !== undefined && previous.direction !== undefined && direction !== undefined) {
		direction = previous.direction;
	}
	let duration = DEFAULT_TRANSITION_SECONDS;
	let easing: Transition['easing'] = { type: 'EASE_OUT' };
	if (previous !== undefined) {
		duration = previous.duration;
		easing = previous.easing;
	}
	return { type: kind, direction, duration, easing };
}

/** The first action of a reaction: the panel edits one action per interaction, like Figma. */
export function primaryAction(reaction: Reaction): Action | undefined {
	return reaction.actions[0];
}

export function destinationOfReaction(reaction: Reaction): NodeId | null {
	return destinationOf(primaryAction(reaction));
}

export function newReaction(destinationId: NodeId | null): Reaction {
	return {
		trigger: { type: 'ON_CLICK' },
		actions: [{ type: 'NODE', destinationId, navigation: 'NAVIGATE' }]
	};
}

export function planSetReactions(
	reader: DocumentReader,
	nodeId: NodeId,
	reactions: readonly Reaction[]
): Change[] {
	return planSetProps(reader, nodeId, { reactions: [...reactions] });
}

export function planAddReaction(
	reader: DocumentReader,
	nodeId: NodeId,
	reaction: Reaction
): Change[] {
	return planSetReactions(reader, nodeId, [...reactionsOf(reader.requireNode(nodeId)), reaction]);
}

export function planReplaceReaction(
	reader: DocumentReader,
	nodeId: NodeId,
	index: number,
	reaction: Reaction
): Change[] {
	const reactions = [...reactionsOf(reader.requireNode(nodeId))];
	if (index < 0 || index >= reactions.length) return [];
	reactions[index] = reaction;
	return planSetReactions(reader, nodeId, reactions);
}

export function planRemoveReaction(
	reader: DocumentReader,
	nodeId: NodeId,
	index: number
): Change[] {
	const reactions = [...reactionsOf(reader.requireNode(nodeId))];
	if (index < 0 || index >= reactions.length) return [];
	reactions.splice(index, 1);
	return planSetReactions(reader, nodeId, reactions);
}

/** Index of the interaction a dragged connection edits: the first plain navigate. */
function connectionIndex(node: Node): number {
	return reactionsOf(node).findIndex((reaction) => {
		const action = primaryAction(reaction);
		if (action === undefined || action.type !== 'NODE') return false;
		return actionKind(action) === 'NAVIGATE';
	});
}

/** Dragging a connection to `destinationId` retargets the node's navigate interaction or adds one. */
export function planConnect(
	reader: DocumentReader,
	sourceId: NodeId,
	destinationId: NodeId
): Change[] {
	const source = reader.requireNode(sourceId);
	const index = connectionIndex(source);
	if (index < 0) return planAddReaction(reader, sourceId, newReaction(destinationId));
	const existing = reactionsOf(source)[index];
	const action = primaryAction(existing);
	if (action === undefined || action.type !== 'NODE') return [];
	const retargeted: Reaction = {
		...existing,
		actions: [{ ...action, destinationId }, ...existing.actions.slice(1)]
	};
	return planReplaceReaction(reader, sourceId, index, retargeted);
}

// ---------- screens and connections ----------

/** Top-level frames: what a connection can lead to and a flow can start at. */
export function isPrototypeScreen(reader: DocumentReader, nodeId: NodeId): boolean {
	const node = reader.getNode(nodeId);
	if (node === undefined || node.type !== 'FRAME' || node.parentId === null) return false;
	const parent = reader.getNode(node.parentId);
	return parent !== undefined && parent.type === 'PAGE';
}

export function topLevelFrames(reader: DocumentReader, pageId: NodeId): Node[] {
	return reader.childNodes(pageId).filter((node) => isPrototypeScreen(reader, node.id));
}

/** The top-level frame `nodeId` sits in (or is). */
export function screenOf(reader: DocumentReader, nodeId: NodeId): NodeId | undefined {
	const chain = [reader.requireNode(nodeId), ...reader.ancestors(nodeId)];
	return chain.find((node) => isPrototypeScreen(reader, node.id))?.id;
}

export interface Connection {
	sourceId: NodeId;
	reactionIndex: number;
	destinationId: NodeId;
}

/** Every navigation-like interaction on the page that points at an existing screen. */
export function connectionsOnPage(reader: DocumentReader, pageId: NodeId): Connection[] {
	const connections: Connection[] = [];
	for (const node of reader.descendants(pageId)) {
		reactionsOf(node).forEach((reaction, reactionIndex) => {
			const destinationId = destinationOfReaction(reaction);
			if (destinationId === null || !isPrototypeScreen(reader, destinationId)) return;
			if (actionKind(primaryAction(reaction)) === 'SCROLL_TO') return;
			connections.push({ sourceId: node.id, reactionIndex, destinationId });
		});
	}
	return connections;
}

// ---------- flows ----------

export type Flow = PageNode['flowStartingPoints'][number];

export function flowsOf(reader: DocumentReader, pageId: NodeId): Flow[] {
	const page = reader.requireNode(pageId);
	if (page.type !== 'PAGE') return [];
	return page.flowStartingPoints.filter((flow) => reader.hasNode(flow.nodeId));
}

export function nextFlowName(flows: readonly Flow[]): string {
	let number = flows.length + 1;
	while (flows.some((flow) => flow.name === `Flow ${number}`)) number += 1;
	return `Flow ${number}`;
}

export function planSetFlows(
	reader: DocumentReader,
	pageId: NodeId,
	flows: readonly Flow[]
): Change[] {
	return planSetProps(reader, pageId, { flowStartingPoints: [...flows] });
}

export function planAddFlow(reader: DocumentReader, pageId: NodeId, nodeId: NodeId): Change[] {
	const flows = flowsOf(reader, pageId);
	if (flows.some((flow) => flow.nodeId === nodeId)) return [];
	return planSetFlows(reader, pageId, [...flows, { nodeId, name: nextFlowName(flows) }]);
}

export function planRenameFlow(
	reader: DocumentReader,
	pageId: NodeId,
	nodeId: NodeId,
	name: string
): Change[] {
	const flows = flowsOf(reader, pageId).map((flow) => {
		if (flow.nodeId === nodeId) return { ...flow, name };
		return flow;
	});
	return planSetFlows(reader, pageId, flows);
}

export function planRemoveFlow(reader: DocumentReader, pageId: NodeId, nodeId: NodeId): Change[] {
	const flows = flowsOf(reader, pageId).filter((flow) => flow.nodeId !== nodeId);
	return planSetFlows(reader, pageId, flows);
}

// ---------- page prototype settings ----------

export const PROTOTYPE_NAMESPACE = 'prototype';
const SETTINGS_KEY = 'settings';

export interface DevicePreset {
	id: string;
	name: string;
	width: number;
	height: number;
	/** Corner radius of the device body around the screen, in screen pixels at scale 1. */
	radius: number;
	bezel: number;
}

export const DEVICE_PRESETS: DevicePreset[] = [
	{ id: 'none', name: 'None', width: 0, height: 0, radius: 0, bezel: 0 },
	{ id: 'phone', name: 'Phone', width: 390, height: 844, radius: 44, bezel: 12 },
	{ id: 'tablet', name: 'Tablet', width: 820, height: 1180, radius: 28, bezel: 16 },
	{ id: 'desktop', name: 'Desktop', width: 1440, height: 900, radius: 10, bezel: 8 }
];

export function devicePreset(id: string): DevicePreset {
	return DEVICE_PRESETS.find((preset) => preset.id === id) ?? DEVICE_PRESETS[0];
}

export interface PrototypeSettings {
	device: string;
}

export function readSettings(page: Node): PrototypeSettings {
	const raw = page.pluginData[PROTOTYPE_NAMESPACE]?.[SETTINGS_KEY];
	if (raw === undefined) return { device: 'none' };
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed === 'object' && parsed !== null) {
			const device: unknown = Reflect.get(parsed, 'device');
			if (typeof device === 'string') return { device };
		}
	} catch {
		return { device: 'none' };
	}
	return { device: 'none' };
}

export function planSetSettings(
	reader: DocumentReader,
	pageId: NodeId,
	settings: PrototypeSettings
): Change[] {
	const page = reader.requireNode(pageId);
	const namespace = {
		...page.pluginData[PROTOTYPE_NAMESPACE],
		[SETTINGS_KEY]: JSON.stringify(settings)
	};
	const pluginData = { ...page.pluginData, [PROTOTYPE_NAMESPACE]: namespace };
	return planSetProps(reader, pageId, { pluginData });
}
