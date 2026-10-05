// What the override indicators call each touched property group (data-model.md section 7).

import type { TouchedGroup } from '../document';

export const GROUP_TITLES: Record<TouchedGroup, string> = {
	name: 'Name',
	visibility: 'Visibility',
	geometry: 'Size and position',
	corners: 'Corner radius',
	fills: 'Fill',
	strokes: 'Stroke',
	effects: 'Effects',
	blend: 'Appearance',
	'auto-layout': 'Auto layout',
	'text-content': 'Text',
	'text-style': 'Text style',
	vector: 'Vector',
	prototype: 'Prototype',
	'component-properties': 'Properties',
	'plugin-data': 'Plugin data'
};
