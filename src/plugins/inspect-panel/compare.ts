// "Compare with main component": the properties an instance has changed from its main component.
// Pure; identity, position and the instance's own link keys are not differences.

import type { InstanceNode, Node } from '../../lib/document';
import { isSameValue } from '../../lib/inspectors/selection';

const IGNORED_KEYS = new Set([
	'id',
	'name',
	'parentId',
	'index',
	'pluginData',
	'componentRef',
	'touched',
	'transform',
	'type',
	'mainComponentId',
	'componentProperties',
	'componentPropertyDefinitions',
	'key',
	'description',
	'variantProperties'
]);

export interface PropertyDifference {
	property: string;
	main: unknown;
	instance: unknown;
}

export function compareWithMain(instance: InstanceNode, main: Node): PropertyDifference[] {
	const differences: PropertyDifference[] = [];
	const mainValues: Record<string, unknown> = { ...main };
	const instanceValues: Record<string, unknown> = { ...instance };
	for (const property of Object.keys(instanceValues)) {
		if (IGNORED_KEYS.has(property)) continue;
		if (isSameValue(instanceValues[property], mainValues[property])) continue;
		differences.push({
			property,
			main: mainValues[property],
			instance: instanceValues[property]
		});
	}
	return differences;
}

/** Short text for a value in the comparison list. */
export function shortValue(value: unknown): string {
	if (value === undefined) return 'none';
	if (typeof value === 'number') return String(Math.round(value * 100) / 100);
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	if (text.length > 40) return `${text.slice(0, 37)}...`;
	return text;
}
