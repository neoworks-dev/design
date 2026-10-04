import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, PointerGesture } from './protocol';

describe('PointerGesture', () => {
	it('starts idle and a release without a press is nothing', () => {
		const gesture = new PointerGesture();
		expect(gesture.phase).toBe('idle');
		expect(gesture.release()).toBe('none');
	});

	it('a press released without crossing the threshold is a click', () => {
		const gesture = new PointerGesture();
		gesture.press({ x: 10, y: 10 });
		expect(gesture.phase).toBe('pressing');
		const update = gesture.move({ x: 10 + DRAG_THRESHOLD_PX - 1, y: 10 });
		expect(update).toMatchObject({ phase: 'pressing', startedDragging: false });
		expect(gesture.release()).toBe('click');
		expect(gesture.phase).toBe('idle');
	});

	it('crossing the threshold starts the drag exactly once', () => {
		const gesture = new PointerGesture();
		gesture.press({ x: 0, y: 0 });
		const first = gesture.move({ x: DRAG_THRESHOLD_PX, y: 0 });
		expect(first).toMatchObject({ phase: 'dragging', startedDragging: true });
		expect(first.delta).toEqual({ x: DRAG_THRESHOLD_PX, y: 0 });
		const second = gesture.move({ x: 50, y: 20 });
		expect(second).toMatchObject({ phase: 'dragging', startedDragging: false });
		expect(second.delta).toEqual({ x: 50, y: 20 });
		expect(gesture.release()).toBe('drag');
	});

	it('measures the threshold as distance, so a diagonal move counts', () => {
		const gesture = new PointerGesture();
		gesture.press({ x: 0, y: 0 });
		expect(gesture.move({ x: 3, y: 3 }).startedDragging).toBe(true);
	});

	it('a dragged-back pointer stays a drag (no click after leaving the threshold)', () => {
		const gesture = new PointerGesture();
		gesture.press({ x: 0, y: 0 });
		gesture.move({ x: 20, y: 0 });
		gesture.move({ x: 0, y: 0 });
		expect(gesture.release()).toBe('drag');
	});

	it('cancel returns to idle without click or drag', () => {
		const gesture = new PointerGesture();
		gesture.press({ x: 0, y: 0 });
		gesture.move({ x: 30, y: 0 });
		gesture.cancel();
		expect(gesture.phase).toBe('idle');
		expect(gesture.release()).toBe('none');
	});

	it('a move while idle reports no drag', () => {
		const gesture = new PointerGesture();
		expect(gesture.move({ x: 100, y: 100 })).toMatchObject({
			phase: 'idle',
			startedDragging: false
		});
	});

	it('takes a custom threshold', () => {
		const gesture = new PointerGesture(10);
		gesture.press({ x: 0, y: 0 });
		expect(gesture.move({ x: 9, y: 0 }).startedDragging).toBe(false);
		expect(gesture.move({ x: 10, y: 0 }).startedDragging).toBe(true);
	});
});
