import { describe, expect, it } from 'vitest';
import type { Action, Reaction, Transition } from '../document';
import { buildDocument, frame, page, rectangle } from '../document/fixtures';
import { DocumentStore } from '../document/store';
import { at } from '../editing/fixtures/editingFixture';
import { renderFrame, type FrameRenderEnvironment } from './frameRender';
import { hotspotsOf } from './hotspots';
import { initialState, reverseTransition, step, stepAll } from './machine';
import { planTransition } from './transitions';

const PUSH_LEFT: Transition = {
	type: 'PUSH',
	direction: 'LEFT',
	duration: 0.3,
	easing: { type: 'EASE_OUT' }
};

function reaction(trigger: Reaction['trigger'], ...actions: Action[]): Reaction {
	return { trigger, actions };
}

function navigateTo(destinationId: string, transition?: Transition): Action {
	return { type: 'NODE', destinationId, navigation: 'NAVIGATE', transition };
}

// Home -> (push) Detail; Detail -> back, opens Menu overlay; Menu closes itself; Feed scrolls.
function fixture(): DocumentStore {
	const click = { type: 'ON_CLICK' } as const;
	return new DocumentStore(
		buildDocument([
			page(
				'Page',
				[
					frame({ id: 'home', transform: at(0, 0), width: 100, height: 200 }, [
						rectangle({
							id: 'go',
							transform: at(10, 10),
							width: 50,
							height: 20,
							reactions: [reaction(click, navigateTo('detail', PUSH_LEFT))]
						}),
						rectangle({
							id: 'link',
							transform: at(10, 50),
							width: 50,
							height: 20,
							reactions: [
								reaction(click, { type: 'URL', url: 'https://example.com', openInNewTab: true })
							]
						})
					]),
					frame({ id: 'detail', transform: at(200, 0), width: 100, height: 200 }, [
						rectangle({
							id: 'back',
							width: 50,
							height: 20,
							reactions: [reaction(click, { type: 'BACK' })]
						}),
						rectangle({
							id: 'menu-button',
							transform: at(0, 40),
							width: 50,
							height: 20,
							reactions: [
								reaction(click, { type: 'NODE', destinationId: 'menu', navigation: 'OVERLAY' })
							]
						}),
						rectangle({
							id: 'jump',
							transform: at(0, 80),
							width: 50,
							height: 20,
							reactions: [
								reaction(
									{ type: 'AFTER_TIMEOUT', timeout: 1 },
									{ type: 'NODE', destinationId: 'feed', navigation: 'NAVIGATE' }
								)
							]
						})
					]),
					frame({ id: 'menu', transform: at(400, 0), width: 60, height: 60 }, [
						rectangle({
							id: 'close',
							width: 60,
							height: 20,
							reactions: [reaction(click, { type: 'CLOSE' })]
						})
					]),
					frame(
						{
							id: 'feed',
							transform: at(600, 0),
							width: 100,
							height: 200,
							overflowDirection: 'VERTICAL_SCROLLING',
							numberOfFixedChildren: 1
						},
						[
							rectangle({ id: 'row', transform: at(0, 0), width: 100, height: 600 }),
							rectangle({
								id: 'bar',
								transform: at(0, 160),
								width: 100,
								height: 40,
								reactions: [
									reaction(click, { type: 'NODE', destinationId: 'row', navigation: 'SCROLL_TO' })
								]
							})
						]
					)
				],
				{ id: 'p' }
			)
		])
	);
}

function actionsOf(store: DocumentStore, nodeId: string): Action[] {
	const node = store.requireNode(nodeId);
	if (!('reactions' in node)) throw new Error('no reactions');
	return node.reactions.flatMap((entry) => entry.actions);
}

describe('player state machine', () => {
	it('navigates, remembers history and goes back with the reversed transition', () => {
		const store = fixture();
		const forward = stepAll(store, initialState('home'), actionsOf(store, 'go'));
		expect(forward.state.current).toBe('detail');
		expect(forward.state.history).toEqual([{ frameId: 'home', via: PUSH_LEFT }]);
		expect(forward.change).toMatchObject({ kind: 'screen', from: 'home', to: 'detail' });

		const back = stepAll(store, forward.state, actionsOf(store, 'back'));
		expect(back.state.current).toBe('home');
		expect(back.change?.transition).toMatchObject({ type: 'PUSH', direction: 'RIGHT' });
		expect(back.state.history).toEqual([]);
	});

	it('back with nothing to go back to does nothing', () => {
		const store = fixture();
		const result = step(store, initialState('home'), { type: 'BACK' });
		expect(result.change).toBeNull();
		expect(result.state.current).toBe('home');
	});

	it('opens and closes overlays without leaving the frame', () => {
		const store = fixture();
		const opened = stepAll(store, initialState('detail'), actionsOf(store, 'menu-button'));
		expect(opened.state).toMatchObject({ current: 'detail', overlays: ['menu'] });
		expect(opened.change).toMatchObject({ kind: 'overlay-open', to: 'menu' });

		const again = stepAll(store, opened.state, actionsOf(store, 'menu-button'));
		expect(again.state.overlays).toEqual(['menu']);

		const closed = stepAll(store, opened.state, actionsOf(store, 'close'));
		expect(closed.state.overlays).toEqual([]);
		expect(closed.change).toMatchObject({ kind: 'overlay-close', from: 'menu' });
	});

	it('navigating clears overlays', () => {
		const store = fixture();
		const state = { ...initialState('detail'), overlays: ['menu'] };
		const result = step(store, state, navigateTo('home'));
		expect(result.state).toMatchObject({ current: 'home', overlays: [] });
	});

	it('ignores dangling and non-frame destinations', () => {
		const store = fixture();
		expect(step(store, initialState('home'), navigateTo('gone')).change).toBeNull();
		expect(step(store, initialState('home'), navigateTo('go')).change).toBeNull();
	});

	it('reports scroll targets and links for the view', () => {
		const store = fixture();
		const scroll = stepAll(store, initialState('feed'), actionsOf(store, 'bar'));
		expect(scroll.scrollTo).toBe('row');
		expect(scroll.change).toBeNull();
		const link = stepAll(store, initialState('home'), actionsOf(store, 'link'));
		expect(link.url).toEqual({ url: 'https://example.com', openInNewTab: true });
	});

	it('stores variable values set by an action', () => {
		const store = fixture();
		const result = step(store, initialState('home'), {
			type: 'SET_VARIABLE',
			variableId: 'v1',
			value: true
		});
		expect(result.state.variables).toEqual({ v1: true });
	});

	it('reverses transitions', () => {
		expect(reverseTransition(undefined)).toBeUndefined();
		expect(reverseTransition({ ...PUSH_LEFT, type: 'MOVE_IN' })).toMatchObject({
			type: 'MOVE_OUT'
		});
		expect(reverseTransition({ ...PUSH_LEFT, type: 'SLIDE_OUT' })).toMatchObject({
			type: 'SLIDE_IN'
		});
	});
});

describe('transition plans', () => {
	const size = { width: 100, height: 200 };

	it('push moves both frames', () => {
		const plan = planTransition(PUSH_LEFT, size);
		expect(plan.incoming[0].transform).toBe('translate(-100px, 0px)');
		expect(plan.outgoing[1].transform).toBe('translate(100px, 0px)');
		expect(plan.durationMilliseconds).toBe(300);
		expect(plan.incomingOnTop).toBe(true);
	});

	it('move out keeps the arriving frame still and underneath', () => {
		const plan = planTransition({ ...PUSH_LEFT, type: 'MOVE_OUT', direction: 'BOTTOM' }, size);
		expect(plan.incomingOnTop).toBe(false);
		expect(plan.outgoing[1].transform).toBe('translate(0px, 200px)');
	});

	it('dissolve fades the arriving frame in; unknown types fall back to it', () => {
		const dissolve = planTransition({ ...PUSH_LEFT, type: 'DISSOLVE', direction: undefined }, size);
		expect(dissolve.incoming[0].opacity).toBe(0);
		const smart = planTransition(
			{ ...PUSH_LEFT, type: 'SMART_ANIMATE', direction: undefined },
			size
		);
		expect(smart.incoming).toEqual(dissolve.incoming);
	});
});

describe('hotspots and frame rendering', () => {
	it('lists nodes with interactions relative to the frame, deepest last', () => {
		const store = fixture();
		const spots = hotspotsOf(store, 'detail', (id) => store.cache.absoluteBounds(id));
		expect(spots.map((spot) => spot.nodeId).sort()).toEqual(['back', 'jump', 'menu-button']);
		const jump = spots.find((spot) => spot.nodeId === 'jump');
		expect(jump?.rect).toEqual({ x: 0, y: 80, width: 50, height: 20 });
		expect(jump?.timeouts).toEqual([1]);
	});

	it('renders a plain frame as one picture and a scrolling frame as one per child', async () => {
		const store = fixture();
		const environment: FrameRenderEnvironment = {
			reader: store,
			boundsOf: (id) => store.cache.absoluteBounds(id),
			renderBoundsOf: (id) => store.cache.absoluteBounds(id),
			imageUrl: (id) => Promise.resolve(`image:${id}`)
		};
		const plain = await renderFrame(environment, 'home');
		expect(plain.layers.map((layer) => layer.url)).toEqual(['image:home']);

		const feed = await renderFrame(environment, 'feed');
		expect(feed.scrollY).toBe(true);
		expect(feed.scrollX).toBe(false);
		expect(feed.layers.map((layer) => [layer.url, layer.fixed])).toEqual([
			['image:row', false],
			['image:bar', true]
		]);
		expect(feed.contentHeight).toBe(600);
		expect(feed.hotspots.find((spot) => spot.nodeId === 'bar')?.fixed).toBe(true);
	});
});
