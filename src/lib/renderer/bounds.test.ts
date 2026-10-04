import { describe, expect, it } from 'vitest';
import { buildDocument, frame, page, rectangle } from '../document/fixtures';
import { SceneBounds, absoluteBoundsOf } from './bounds';
import { StoreSceneSource } from './storeSceneSource';

function setup(): { source: StoreSceneSource; bounds: SceneBounds; stop: () => void } {
	const source = new StoreSceneSource(
		buildDocument([
			page('P', [
				frame({ id: 'F', width: 100, height: 100 }, [rectangle({ id: 'R', width: 10, height: 10 })])
			])
		])
	);
	const bounds = new SceneBounds(source);
	const stop = source.subscribe((notification) => bounds.handle(notification));
	return { source, bounds, stop };
}

describe('SceneBounds', () => {
	it('follows moves of an ancestor and resizes, matching the cold computation', () => {
		const { source, bounds } = setup();
		expect(bounds.absoluteBoundsOf('R')).toEqual({ x: 0, y: 0, width: 10, height: 10 });
		source.apply([
			{
				t: 'set',
				id: 'F',
				set: {
					transform: [
						[1, 0, 40],
						[0, 1, 50]
					]
				},
				prev: {
					transform: [
						[1, 0, 0],
						[0, 1, 0]
					]
				}
			}
		]);
		expect(bounds.absoluteBoundsOf('R')).toEqual({ x: 40, y: 50, width: 10, height: 10 });
		source.apply([{ t: 'set', id: 'R', set: { width: 30 }, prev: { width: 10 } }]);
		expect(bounds.absoluteBoundsOf('R')).toEqual(absoluteBoundsOf(source, 'R'));
		expect(bounds.absoluteBoundsOf('R')?.width).toBe(30);
	});

	it('does not subscribe by itself and forgets everything on reset', () => {
		const { source, bounds, stop } = setup();
		stop();
		expect(source.listenerCount).toBe(0);
		bounds.absoluteBoundsOf('R');
		bounds.handle({ kind: 'reset' });
		expect(bounds.pageContentBounds()).toEqual({ x: 0, y: 0, width: 100, height: 100 });
	});
});
