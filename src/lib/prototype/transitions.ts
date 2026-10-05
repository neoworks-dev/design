// Animation plans for screen changes: keyframes for the arriving and the leaving frame, computed
// from the transition and the frame size. Pure; the view feeds them to `Element.animate`.
// Smart animate and scroll animate need layer matching (a deferred risk item) and play as a
// dissolve.

import type { Transition } from '../document';

export type PlanKeyframe = { transform: string; opacity: number };

export interface TransitionPlan {
	incoming: PlanKeyframe[];
	outgoing: PlanKeyframe[];
	/** Whether the arriving frame is drawn above the leaving one for the animation. */
	incomingOnTop: boolean;
	durationMilliseconds: number;
	easing: string;
}

export interface FrameSize {
	width: number;
	height: number;
}

const EASING_CSS: Record<string, string> = {
	LINEAR: 'linear',
	EASE_IN: 'cubic-bezier(0.42, 0, 1, 1)',
	EASE_OUT: 'cubic-bezier(0, 0, 0.58, 1)',
	EASE_IN_AND_OUT: 'cubic-bezier(0.42, 0, 0.58, 1)'
};

const SLIDE_PARALLAX = 0.3;

export function easingCss(easing: Transition['easing']): string {
	if (easing.bezier !== undefined) return `cubic-bezier(${easing.bezier.join(', ')})`;
	const known = EASING_CSS[easing.type];
	if (known === undefined) return 'ease-out';
	return known;
}

function translate(x: number, y: number): string {
	return `translate(${x}px, ${y}px)`;
}

/** Offset of a frame that sits just outside the viewport on `direction`'s side. */
function offsetFor(direction: Transition['direction'], size: FrameSize): { x: number; y: number } {
	if (direction === 'RIGHT') return { x: size.width, y: 0 };
	if (direction === 'TOP') return { x: 0, y: -size.height };
	if (direction === 'BOTTOM') return { x: 0, y: size.height };
	return { x: -size.width, y: 0 };
}

const REST: PlanKeyframe = { transform: translate(0, 0), opacity: 1 };

function at(x: number, y: number, opacity = 1): PlanKeyframe {
	return { transform: translate(x, y), opacity };
}

function plan(
	transition: Transition,
	incoming: PlanKeyframe[],
	outgoing: PlanKeyframe[],
	incomingOnTop: boolean
): TransitionPlan {
	return {
		incoming,
		outgoing,
		incomingOnTop,
		durationMilliseconds: Math.round(transition.duration * 1000),
		easing: easingCss(transition.easing)
	};
}

export function planTransition(transition: Transition, size: FrameSize): TransitionPlan {
	const offset = offsetFor(transition.direction, size);
	if (transition.type === 'MOVE_IN') {
		return plan(transition, [at(offset.x, offset.y), REST], [REST, REST], true);
	}
	if (transition.type === 'MOVE_OUT') {
		return plan(transition, [REST, REST], [REST, at(offset.x, offset.y)], false);
	}
	if (transition.type === 'PUSH') {
		return plan(transition, [at(offset.x, offset.y), REST], [REST, at(-offset.x, -offset.y)], true);
	}
	if (transition.type === 'SLIDE_IN') {
		const outgoing = [REST, at(-offset.x * SLIDE_PARALLAX, -offset.y * SLIDE_PARALLAX)];
		return plan(transition, [at(offset.x, offset.y), REST], outgoing, true);
	}
	if (transition.type === 'SLIDE_OUT') {
		const incoming = [at(-offset.x * SLIDE_PARALLAX, -offset.y * SLIDE_PARALLAX), REST];
		return plan(transition, incoming, [REST, at(offset.x, offset.y)], false);
	}
	return plan(transition, [at(0, 0, 0), REST], [REST, REST], true);
}
