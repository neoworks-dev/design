import { describe, expect, it } from 'vitest';
import { pageDropTarget } from './pageDrop';

describe('pageDropTarget', () => {
	it('rounds to the nearest line between rows', () => {
		expect(pageDropTarget(5, 4, 2).slot).toBe(0);
		expect(pageDropTarget(20, 4, 2).slot).toBe(1);
		expect(pageDropTarget(100, 4, 2).slot).toBe(4);
		expect(pageDropTarget(-30, 4, 2).slot).toBe(0);
		expect(pageDropTarget(900, 4, 2).slot).toBe(4);
	});

	it('moving down skips the dragged page itself', () => {
		// page 0 dropped on the line below page 2: ends up at index 2 once removed from the front
		expect(pageDropTarget(3 * 28, 4, 0)).toEqual({ slot: 3, position: 2 });
	});

	it('moving up keeps the slot as the position', () => {
		expect(pageDropTarget(28, 4, 3)).toEqual({ slot: 1, position: 1 });
	});

	it('dropping next to its own row changes nothing', () => {
		expect(pageDropTarget(2 * 28, 4, 2).position).toBe(2);
		expect(pageDropTarget(3 * 28, 4, 2).position).toBe(2);
	});
});
