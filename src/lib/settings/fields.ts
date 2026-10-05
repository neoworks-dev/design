// Turns a plugin's `Config` schema into a flat list of editable fields. Standard Schema only
// offers `validate`, so introspection goes through zod's JSON Schema export; a schema from another
// library (or a shape the form cannot express, like nested objects) yields no fields and the
// plugin simply has no section in Settings.

import type { StandardSchemaV1 } from '@neoworks/extension-system';
import { z } from 'zod';

/** `data` is a stored value the form cannot edit (a list or an object): kept, never shown. */
export type SettingFieldKind = 'boolean' | 'number' | 'text' | 'choice' | 'data';

export interface SettingField {
	key: string;
	label: string;
	kind: SettingFieldKind;
	defaultValue: unknown;
	description?: string;
	options?: string[];
	min?: number;
	max?: number;
	integer?: boolean;
	/** Stored with the settings but not offered in the form (`.meta({ hidden: true })`). */
	hidden?: boolean;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function humanize(key: string): string {
	const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ');
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function optionalNumber(value: unknown): number | undefined {
	if (typeof value === 'number') return value;
	return undefined;
}

function optionalString(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	return undefined;
}

function fieldKind(property: JsonObject): SettingFieldKind | undefined {
	if (Array.isArray(property.enum)) return 'choice';
	if (property.type === 'boolean') return 'boolean';
	if (property.type === 'number' || property.type === 'integer') return 'number';
	if (property.type === 'string') return 'text';
	if (property.type === 'array' || property.type === 'object') return 'data';
	return undefined;
}

function buildField(key: string, property: JsonObject): SettingField | undefined {
	const kind = fieldKind(property);
	if (kind === undefined) return undefined;
	const title = optionalString(property.title);
	const field: SettingField = {
		key,
		label: title === undefined ? humanize(key) : title,
		kind,
		defaultValue: property.default
	};
	const description = optionalString(property.description);
	if (description !== undefined) field.description = description;
	if (Array.isArray(property.enum)) {
		field.options = property.enum.filter((entry): entry is string => typeof entry === 'string');
	}
	field.min = optionalNumber(property.minimum);
	field.max = optionalNumber(property.maximum);
	if (optionalNumber(property.exclusiveMinimum) !== undefined) {
		field.min = optionalNumber(property.exclusiveMinimum);
	}
	if (property.type === 'integer') field.integer = true;
	if (property.hidden === true) field.hidden = true;
	return field;
}

/** The editable fields of `schema`; empty for a schema this cannot introspect. */
export function describeSchema(schema: StandardSchemaV1): SettingField[] {
	if (schema['~standard'].vendor !== 'zod') return [];
	let json: unknown;
	try {
		json = z.toJSONSchema(schema as z.ZodType, { io: 'input', unrepresentable: 'any' });
	} catch {
		return [];
	}
	if (!isJsonObject(json) || !isJsonObject(json.properties)) return [];
	const fields: SettingField[] = [];
	for (const [key, property] of Object.entries(json.properties)) {
		if (!isJsonObject(property)) continue;
		const field = buildField(key, property);
		if (field !== undefined) fields.push(field);
	}
	return fields;
}

function sameValue(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (typeof left !== 'object' || typeof right !== 'object') return false;
	return JSON.stringify(left) === JSON.stringify(right);
}

/** The fields the form shows. */
export function visibleFields(fields: SettingField[]): SettingField[] {
	return fields.filter((field) => field.kind !== 'data' && field.hidden !== true);
}

/** The entries of `config` that differ from the field defaults: what is worth storing. */
export function overridesOf(config: unknown, fields: SettingField[]): Record<string, unknown> {
	if (!isJsonObject(config)) return {};
	const overrides: Record<string, unknown> = {};
	for (const field of fields) {
		if (!(field.key in config)) continue;
		const value = config[field.key];
		if (sameValue(value, field.defaultValue)) continue;
		overrides[field.key] = value;
	}
	return overrides;
}

/** Messages of a failed Standard Schema validation, one line. */
export function describeIssues(issues: ReadonlyArray<StandardSchemaV1.Issue>): string {
	return issues.map((issue) => issue.message).join('; ');
}
