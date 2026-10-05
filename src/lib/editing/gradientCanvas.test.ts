import { describe, expect, it } from 'vitest';
import type { GradientPaint, Matrix2x3 } from '../document/types';
import { defaultGradientTransform } from './gradient';
import { hitTarget, NodeSpace, placedTargets } from './gradientCanvas';

const nodeAt: Matrix2x3 = [
	[1, 0, 100],
	[0, 1, 50]
];

function paint(): GradientPaint {
	return {
		type: 'GRADIENT_LINEAR',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		gradientTransform: defaultGradientTransform(),
		gradientStops: [
			{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
			{ position: 0.5, color: { r: 0.5, g: 0, b: 0, a: 1 } },
			{ position: 1, color: { r: 1, g: 0, b: 0, a: 1 } }
		]
	};
}

describe('gradient canvas targets', () => {
	const space = new NodeSpace(nodeAt, { width: 200, height: 100 });

	it('places the default linear handles on the node edges in world space', () => {
		const [origin, end] = placedTargets(paint(), space);
		expect(origin.world).toEqual({ x: 100, y: 100 });
		expect(end.world).toEqual({ x: 300, y: 100 });
	});

	it('converts a world point back to the normalized box', () => {
		expect(space.toNormalized({ x: 200, y: 100 })).toEqual({ x: 0.5, y: 0.5 });
	});

	it('hits the middle stop and prefers handles on a tie', () => {
		expect(hitTarget(paint(), space, { x: 202, y: 101 }, 8)).toEqual({ kind: 'stop', index: 1 });
		expect(hitTarget(paint(), space, { x: 102, y: 100 }, 8)).toEqual({
			kind: 'handle',
			handle: 'origin'
		});
		expect(hitTarget(paint(), space, { x: 150, y: 20 }, 8)).toBeUndefined();
	});
});
