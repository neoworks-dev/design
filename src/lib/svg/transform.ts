// The SVG `transform` attribute as one matrix (#106). Lists apply left to right like in SVG:
// `translate(10) rotate(45)` rotates first in the translated system.

import { composeMatrices, identityMatrix } from '../document/matrix';
import type { Matrix2x3 } from '../document/types';

const ITEM = /([a-zA-Z]+)\s*\(([^)]*)\)/g;

function numbers(source: string): number[] {
	return source
		.split(/[\s,]+/)
		.filter((part) => part !== '')
		.map(Number);
}

function matrixOf(name: string, args: number[]): Matrix2x3 | null {
	if (args.some((value) => !Number.isFinite(value))) return null;
	switch (name) {
		case 'matrix':
			if (args.length !== 6) return null;
			return [
				[args[0], args[2], args[4]],
				[args[1], args[3], args[5]]
			];
		case 'translate':
			return [
				[1, 0, args[0] ?? 0],
				[0, 1, args[1] ?? 0]
			];
		case 'scale': {
			const x = args[0] ?? 1;
			const y = args.length > 1 ? args[1] : x;
			return [
				[x, 0, 0],
				[0, y, 0]
			];
		}
		case 'rotate':
			return rotation(args);
		case 'skewx':
			return [
				[1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0],
				[0, 1, 0]
			];
		case 'skewy':
			return [
				[1, 0, 0],
				[Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0]
			];
		default:
			return null;
	}
}

function rotation(args: number[]): Matrix2x3 {
	const angle = ((args[0] ?? 0) * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const aroundX = args[1] ?? 0;
	const aroundY = args[2] ?? 0;
	return [
		[cos, -sin, aroundX - cos * aroundX + sin * aroundY],
		[sin, cos, aroundY - sin * aroundX - cos * aroundY]
	];
}

/** The matrix of a transform list; an unknown or malformed item makes the whole list identity. */
export function parseTransform(value: string | null): Matrix2x3 {
	if (value === null) return identityMatrix();
	let result = identityMatrix();
	for (const match of value.matchAll(ITEM)) {
		const matrix = matrixOf(match[1].toLowerCase(), numbers(match[2]));
		if (matrix === null) return identityMatrix();
		result = composeMatrices(result, matrix);
	}
	return result;
}
