import { describe, expect, it } from 'vitest';
import { createNode } from './defaults';
import { scaledProps } from './scale';

describe('scaledProps', () => {
	it('scales vector network points and tangents with the node', () => {
		const vector = createNode('VECTOR', {
			width: 10,
			height: 10,
			network: {
				vertices: [
					{ x: 0, y: 0 },
					{ x: 10, y: 4, cornerRadius: 2 }
				],
				segments: [{ start: 0, end: 1, tangentStart: { x: 1, y: 2 } }]
			}
		});
		const props = scaledProps(vector, 3);
		expect(props.network).toEqual({
			vertices: [
				{ x: 0, y: 0 },
				{ x: 30, y: 12, cornerRadius: 6 }
			],
			segments: [{ start: 0, end: 1, tangentStart: { x: 3, y: 6 } }]
		});
	});

	it('scales pixel letter spacing and line height but not percentages or auto', () => {
		const text = createNode('TEXT', {
			defaultStyle: {
				...createNode('TEXT').defaultStyle,
				letterSpacing: { value: 2, unit: 'PIXELS' },
				lineHeight: { unit: 'AUTO' }
			}
		});
		const props = scaledProps(text, 2);
		const style = props.defaultStyle as { letterSpacing: unknown; lineHeight: unknown };
		expect(style.letterSpacing).toEqual({ value: 4, unit: 'PIXELS' });
		expect(style.lineHeight).toEqual({ unit: 'AUTO' });
	});

	it('scales shadow offsets and blur radii', () => {
		const rectangle = createNode('RECTANGLE', {
			effects: [
				{
					type: 'DROP_SHADOW',
					visible: true,
					color: { r: 0, g: 0, b: 0, a: 1 },
					offset: { x: 1, y: 2 },
					radius: 4,
					spread: 1,
					blendMode: 'NORMAL'
				},
				{ type: 'LAYER_BLUR', visible: true, radius: 6 }
			]
		});
		const props = scaledProps(rectangle, 2);
		expect(props.effects).toMatchObject([
			{ offset: { x: 2, y: 4 }, radius: 8, spread: 2 },
			{ radius: 12 }
		]);
	});
});
