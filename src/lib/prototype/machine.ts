// The prototype player's state machine: which frame is showing, how to go back, which overlays are
// open, and what an action does to that. Pure and framework-free: `step` takes the document, the
// current state and an action and returns the next state plus what the view must do (animate a
// transition, scroll, open a link). The view owns timers and pointer input (see PlayerView).

import type {
	Action,
	DocumentReader,
	NodeId,
	Reaction,
	Transition,
	VariableValue
} from '../document';
import { isPrototypeScreen, reactionsOf, triggerKind, type TriggerKind } from './model';

export interface HistoryEntry {
	frameId: NodeId;
	/** The transition used to leave this frame; Back plays it in reverse. */
	via: Transition | undefined;
}

export interface PlayerState {
	current: NodeId;
	history: HistoryEntry[];
	overlays: NodeId[];
	variables: Record<string, VariableValue>;
}

export type ChangeKind = 'screen' | 'overlay-open' | 'overlay-close' | 'overlay-swap';

/** What the view animates after a step. */
export interface ScreenChange {
	kind: ChangeKind;
	/** The frame leaving, if any. */
	from: NodeId | null;
	/** The frame arriving, if any. */
	to: NodeId | null;
	transition: Transition | undefined;
}

export interface StepResult {
	state: PlayerState;
	change: ScreenChange | null;
	scrollTo: NodeId | null;
	url: { url: string; openInNewTab: boolean } | null;
}

export function initialState(startFrame: NodeId): PlayerState {
	return { current: startFrame, history: [], overlays: [], variables: {} };
}

function unchanged(state: PlayerState): StepResult {
	return { state, change: null, scrollTo: null, url: null };
}

const OPPOSITE: Record<
	NonNullable<Transition['direction']>,
	NonNullable<Transition['direction']>
> = { LEFT: 'RIGHT', RIGHT: 'LEFT', TOP: 'BOTTOM', BOTTOM: 'TOP' };

/** The transition that undoes `transition`: what Back plays. */
export function reverseTransition(transition: Transition | undefined): Transition | undefined {
	if (transition === undefined) return undefined;
	const reversed: Record<Transition['type'], Transition['type']> = {
		DISSOLVE: 'DISSOLVE',
		SMART_ANIMATE: 'SMART_ANIMATE',
		SCROLL_ANIMATE: 'SCROLL_ANIMATE',
		MOVE_IN: 'MOVE_OUT',
		MOVE_OUT: 'MOVE_IN',
		PUSH: 'PUSH',
		SLIDE_IN: 'SLIDE_OUT',
		SLIDE_OUT: 'SLIDE_IN'
	};
	let direction = transition.direction;
	if (transition.type === 'PUSH' && direction !== undefined) direction = OPPOSITE[direction];
	return { ...transition, type: reversed[transition.type], direction };
}

function navigate(
	reader: DocumentReader,
	state: PlayerState,
	destinationId: NodeId | null,
	transition: Transition | undefined,
	remember: boolean
): StepResult {
	if (destinationId === null || !isPrototypeScreen(reader, destinationId)) return unchanged(state);
	if (destinationId === state.current && state.overlays.length === 0) return unchanged(state);
	let history = state.history;
	if (remember) history = [...history, { frameId: state.current, via: transition }];
	const next: PlayerState = { ...state, current: destinationId, history, overlays: [] };
	const change: ScreenChange = {
		kind: 'screen',
		from: state.current,
		to: destinationId,
		transition
	};
	return { state: next, change, scrollTo: null, url: null };
}

function openOverlay(
	reader: DocumentReader,
	state: PlayerState,
	destinationId: NodeId | null,
	transition: Transition | undefined
): StepResult {
	if (destinationId === null || !reader.hasNode(destinationId)) return unchanged(state);
	if (state.overlays.includes(destinationId)) return unchanged(state);
	const next = { ...state, overlays: [...state.overlays, destinationId] };
	const change: ScreenChange = { kind: 'overlay-open', from: null, to: destinationId, transition };
	return { state: next, change, scrollTo: null, url: null };
}

function swapOverlay(
	reader: DocumentReader,
	state: PlayerState,
	destinationId: NodeId | null,
	transition: Transition | undefined
): StepResult {
	if (destinationId === null || !reader.hasNode(destinationId)) return unchanged(state);
	const closing = state.overlays[state.overlays.length - 1];
	if (closing === undefined) return navigate(reader, state, destinationId, transition, false);
	const overlays = [...state.overlays.slice(0, -1), destinationId];
	const change: ScreenChange = {
		kind: 'overlay-swap',
		from: closing,
		to: destinationId,
		transition
	};
	return { state: { ...state, overlays }, change, scrollTo: null, url: null };
}

function closeOverlay(state: PlayerState): StepResult {
	const closing = state.overlays[state.overlays.length - 1];
	if (closing === undefined) return unchanged(state);
	const change: ScreenChange = {
		kind: 'overlay-close',
		from: closing,
		to: null,
		transition: undefined
	};
	return {
		state: { ...state, overlays: state.overlays.slice(0, -1) },
		change,
		scrollTo: null,
		url: null
	};
}

function goBack(state: PlayerState): StepResult {
	const previous = state.history[state.history.length - 1];
	if (previous === undefined) return unchanged(state);
	const next: PlayerState = {
		...state,
		current: previous.frameId,
		history: state.history.slice(0, -1),
		overlays: []
	};
	const change: ScreenChange = {
		kind: 'screen',
		from: state.current,
		to: previous.frameId,
		transition: reverseTransition(previous.via)
	};
	return { state: next, change, scrollTo: null, url: null };
}

function performNodeAction(
	reader: DocumentReader,
	state: PlayerState,
	action: Extract<Action, { type: 'NODE' }>
): StepResult {
	const { destinationId, transition } = action;
	if (action.navigation === 'NAVIGATE')
		return navigate(reader, state, destinationId, transition, true);
	if (action.navigation === 'SWAP') return swapOverlay(reader, state, destinationId, transition);
	if (action.navigation === 'OVERLAY') return openOverlay(reader, state, destinationId, transition);
	if (action.navigation === 'SCROLL_TO' && destinationId !== null) {
		return { ...unchanged(state), scrollTo: destinationId };
	}
	return unchanged(state);
}

/** Apply one action to `state`. Unknown or dangling targets leave the state as it is. */
export function step(reader: DocumentReader, state: PlayerState, action: Action): StepResult {
	if (action.type === 'BACK') return goBack(state);
	if (action.type === 'CLOSE') return closeOverlay(state);
	if (action.type === 'URL') {
		return {
			...unchanged(state),
			url: { url: action.url, openInNewTab: action.openInNewTab === true }
		};
	}
	if (action.type === 'SET_VARIABLE') {
		const variables = { ...state.variables, [action.variableId]: action.value };
		return unchanged({ ...state, variables });
	}
	if (action.type !== 'NODE') return unchanged(state);
	return performNodeAction(reader, state, action);
}

/** Run several actions in order, merging what the view has to do (the last change wins). */
export function stepAll(
	reader: DocumentReader,
	state: PlayerState,
	actions: readonly Action[]
): StepResult {
	let result = unchanged(state);
	for (const action of actions) {
		const next = step(reader, result.state, action);
		result = {
			state: next.state,
			change: next.change ?? result.change,
			scrollTo: next.scrollTo ?? result.scrollTo,
			url: next.url ?? result.url
		};
	}
	return result;
}

export interface FiredReaction {
	nodeId: NodeId;
	reaction: Reaction;
}

/** The reactions on `nodeId` that listen for `kind` (and, for keys, `keyCode`). */
export function reactionsListeningTo(
	reader: DocumentReader,
	nodeId: NodeId,
	kind: TriggerKind,
	keyCode?: number
): FiredReaction[] {
	const node = reader.getNode(nodeId);
	if (node === undefined) return [];
	return reactionsOf(node)
		.filter((reaction) => {
			if (triggerKind(reaction.trigger) !== kind) return false;
			if (kind !== 'ON_KEY_DOWN') return true;
			const trigger = reaction.trigger;
			return (
				trigger !== null &&
				trigger.type === 'ON_KEY_DOWN' &&
				trigger.keyCodes.includes(keyCode ?? -1)
			);
		})
		.map((reaction) => ({ nodeId, reaction }));
}
