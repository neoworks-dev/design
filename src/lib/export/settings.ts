// Pure helpers of the export settings model (#125): defaults, the scale a setting asks for, and
// file names. Settings themselves are node data (`exportSettings`), changed through
// `document.apply` like every other property.

import type { ExportSetting } from '../document/types';
import type { ExportFormatName } from './types';

export const MIN_EXPORT_SCALE = 0.5;
export const MAX_EXPORT_SCALE = 4;

export const SCALE_PRESETS = [0.5, 0.75, 1, 1.5, 2, 3, 4];

export function defaultExportSetting(): ExportSetting {
	return { suffix: '', format: 'PNG', constraint: { type: 'SCALE', value: 1 } };
}

/** Pixels per document unit that makes `size` come out as the setting's constraint says. */
export function scaleFor(setting: ExportSetting, size: { width: number; height: number }): number {
	const { type, value } = setting.constraint;
	if (type === 'SCALE') return value;
	if (type === 'WIDTH') return value / Math.max(size.width, 1e-6);
	return value / Math.max(size.height, 1e-6);
}

/** The text of a constraint as the user types it: `2x`, `512w`, `256h`. */
export function formatConstraint(constraint: ExportSetting['constraint']): string {
	if (constraint.type === 'SCALE') return `${constraint.value}x`;
	if (constraint.type === 'WIDTH') return `${constraint.value}w`;
	return `${constraint.value}h`;
}

/** Parses `2x`, `2`, `512w`, `256h`; `null` when it is none of them or out of range. */
export function parseConstraint(text: string): ExportSetting['constraint'] | null {
	const match = /^\s*(\d+(?:\.\d+)?)\s*(x|w|h|px)?\s*$/i.exec(text);
	if (match === null) return null;
	const value = Number(match[1]);
	let unit = 'x';
	if (match[2] !== undefined) unit = match[2].toLowerCase();
	if (unit === 'x') {
		if (value < MIN_EXPORT_SCALE || value > MAX_EXPORT_SCALE) return null;
		return { type: 'SCALE', value };
	}
	if (!(value >= 1)) return null;
	if (unit === 'h') return { type: 'HEIGHT', value };
	return { type: 'WIDTH', value };
}

/** Figma's suggestion for a scale: `@2x`, nothing for 1x. */
export function suffixForConstraint(constraint: ExportSetting['constraint']): string {
	if (constraint.type !== 'SCALE') return '';
	if (constraint.value === 1) return '';
	return `@${constraint.value}x`;
}

const EXTENSIONS: Record<ExportFormatName, string> = {
	PNG: 'png',
	JPG: 'jpg',
	WEBP: 'webp',
	SVG: 'svg',
	PDF: 'pdf'
};

export function extensionOf(format: ExportFormatName): string {
	return EXTENSIONS[format];
}

/** A file name stem without characters that paths treat specially. */
export function safeFileStem(name: string): string {
	// oxlint-disable-next-line no-control-regex
	const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
	if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'Untitled';
	return cleaned;
}

export function fileNameFor(
	nodeName: string,
	setting: ExportSetting,
	extension: string = extensionOf(setting.format)
): string {
	return `${safeFileStem(nodeName)}${setting.suffix}.${extension}`;
}

/** Makes names unique in order of appearance: `A.png`, `A (2).png`, `A (3).png`. */
export function uniqueFileNames(names: readonly string[]): string[] {
	const used = new Set<string>();
	return names.map((name) => {
		let candidate = name;
		let counter = 2;
		while (used.has(candidate.toLowerCase())) {
			candidate = withCounter(name, counter);
			counter += 1;
		}
		used.add(candidate.toLowerCase());
		return candidate;
	});
}

function withCounter(name: string, counter: number): string {
	const dot = name.lastIndexOf('.');
	if (dot <= 0) return `${name} (${counter})`;
	return `${name.slice(0, dot)} (${counter})${name.slice(dot)}`;
}
