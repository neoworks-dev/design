// A document that touches every table of the file format, for the store tests. Deterministic ids
// and values so it can be compared and committed as a golden fixture.

import {
	buildDocument,
	frame,
	group,
	page,
	rectangle,
	text
} from '../../src/lib/document/fixtures';
import type { DesignDocument } from '../../src/lib/document/types';

export function richDocument(): DesignDocument {
	const document = buildDocument([
		page('Home', [
			frame({ name: 'Hero', width: 800, height: 400 }, [
				rectangle({
					name: 'Background',
					boundVariables: { width: { type: 'VARIABLE_ALIAS', id: 'v-width' } }
				}),
				text({ name: 'Title' }),
				group({ name: 'Badges' }, [rectangle({ name: 'Badge 1' }), rectangle({ name: 'Badge 2' })])
			]),
			frame({ name: 'Footer' })
		]),
		page('Components'),
		page('Archive', [rectangle({ name: 'Old' })])
	]);
	document.id = 'doc-rich';
	document.name = 'Rich fixture';
	document.styles = {
		's-primary': {
			id: 's-primary',
			type: 'PAINT',
			name: 'Primary',
			description: 'brand fill',
			value: { type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.9 } }
		}
	};
	document.variableCollections = {
		'c-theme': {
			id: 'c-theme',
			name: 'Theme',
			modes: [
				{ modeId: 'm-light', name: 'Light' },
				{ modeId: 'm-dark', name: 'Dark' }
			],
			defaultModeId: 'm-light',
			variableIds: ['v-width']
		}
	};
	document.variables = {
		'v-width': {
			id: 'v-width',
			name: 'width',
			collectionId: 'c-theme',
			resolvedType: 'FLOAT',
			valuesByMode: { 'm-light': 320, 'm-dark': 360 },
			scopes: ['WIDTH_HEIGHT'],
			codeSyntax: { WEB: 'var(--width)' },
			description: ''
		}
	};
	const pngHash = 'a'.repeat(64);
	const svgHash = 'b'.repeat(64);
	document.assets = {
		[pngHash]: { id: pngHash, mime: 'image/png', width: 64, height: 32 },
		[svgHash]: { id: svgHash, mime: 'image/svg+xml' }
	};
	document.fonts = [
		{ family: 'Inter', style: 'Regular', source: 'system' },
		{ family: 'Brand Sans', style: 'Bold', source: 'embedded' }
	];
	return document;
}
