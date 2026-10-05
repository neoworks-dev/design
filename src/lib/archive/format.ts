// The zip-of-JSON archive format (#31, data-model.md section 6 last line): a design file as text
// that diffs and shares well. Pure data in, pure data out; the zip container and the disk are
// main's business (electron/archive).
//
// Layout (every path is deterministic):
//   manifest.json            format, versions, name, the pages in order, font references
//   pages/<page>.json        the nodes of one page, depth first, children in index order
//   orphans.json             nodes no page reaches (only present when there are any)
//   styles.json              styles by id
//   variables.json           variable collections and variables by id
//   assets.json              asset records (metadata) by hash
//   assets/<hash>.<ext>      the image bytes
//   fonts/<n>.font           embedded font files, listed in the manifest
//
// JSON is written with sorted keys, two-space indent and a trailing newline, so equal documents
// give equal bytes and a change to one node is a change to a few lines of one file. Reading goes
// through `parseDesignDocument`, the validator the store loader uses.

import type { ArchiveEntry } from '../../../electron/bridge';
import { parseDesignDocument } from '../document/schema';
import {
	SCHEMA_VERSION,
	type DesignDocument,
	type FontReference,
	type Node,
	type NodeId
} from '../document/types';

export const ARCHIVE_FORMAT = 'neoworks-design-archive';
export const ARCHIVE_VERSION = 1;

export class ArchiveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ArchiveError';
	}
}

export interface ArchiveFont {
	family: string;
	style: string;
	bytes: Uint8Array;
}
export interface ArchiveImage {
	hash: string;
	mime: string;
	width?: number;
	height?: number;
	bytes: Uint8Array;
}
export interface ArchiveContents {
	document: DesignDocument;
	images: ArchiveImage[];
	fonts: ArchiveFont[];
	/** Asset records the archive has no bytes for. */
	missingImages: string[];
}

interface Manifest {
	format: string;
	formatVersion: number;
	schemaVersion: number;
	id: string;
	name: string;
	pages: Array<{ id: string; file: string }>;
	fonts: FontReference[];
	embeddedFonts: Array<{ family: string; style: string; file: string }>;
}

// ---------- writing ----------

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (typeof value !== 'object' || value === null) return value;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort(compareText)) {
		sorted[key] = sortKeys(Reflect.get(value, key));
	}
	return sorted;
}

function compareText(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

/** JSON with sorted keys and a trailing newline: the same value always gives the same text. */
export function stableJson(value: unknown): string {
	return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function jsonEntry(path: string, value: unknown): ArchiveEntry {
	return { path, bytes: new TextEncoder().encode(stableJson(value)) };
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
	const sorted: Record<string, T> = {};
	for (const key of Object.keys(record).sort(compareText)) sorted[key] = record[key];
	return sorted;
}

function compareNodes(left: Node, right: Node): number {
	return compareText(left.index, right.index) || compareText(left.id, right.id);
}

/** File-name safe form of an id: letters, digits, `-` and `_` stay, everything else is `~hex`. */
export function fileSafe(id: string): string {
	let safe = '';
	for (const character of id) {
		if (/[A-Za-z0-9_-]/.test(character)) {
			safe += character;
			continue;
		}
		safe += `~${(character.codePointAt(0) ?? 0).toString(16)}`;
	}
	return safe;
}

function childrenByParent(document: DesignDocument): Map<NodeId | null, Node[]> {
	const groups = new Map<NodeId | null, Node[]>();
	for (const node of Object.values(document.nodes)) {
		const siblings = groups.get(node.parentId);
		if (siblings === undefined) groups.set(node.parentId, [node]);
		else siblings.push(node);
	}
	for (const siblings of groups.values()) siblings.sort(compareNodes);
	return groups;
}

function depthFirst(root: Node, groups: Map<NodeId | null, Node[]>, visited: Set<NodeId>): Node[] {
	const ordered: Node[] = [];
	const stack: Node[] = [root];
	while (stack.length > 0) {
		const node = stack.pop();
		if (node === undefined || visited.has(node.id)) continue;
		visited.add(node.id);
		ordered.push(node);
		const children = groups.get(node.id);
		if (children === undefined) continue;
		for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
	}
	return ordered;
}

function extensionOf(mime: string): string {
	if (mime === 'image/png') return 'png';
	if (mime === 'image/jpeg') return 'jpg';
	if (mime === 'image/webp') return 'webp';
	if (mime === 'image/gif') return 'gif';
	if (mime === 'image/svg+xml') return 'svg';
	return 'bin';
}

function fontFileName(index: number): string {
	return `fonts/${String(index).padStart(4, '0')}.font`;
}

/**
 * The files of an archive of `document`. `imageBytes` maps asset hashes to their bytes; assets
 * without bytes are listed in `assets.json` only. Pure and deterministic.
 */
export function buildArchive(
	document: DesignDocument,
	imageBytes: ReadonlyMap<string, Uint8Array>,
	fonts: readonly ArchiveFont[]
): ArchiveEntry[] {
	const entries: ArchiveEntry[] = [];
	const groups = childrenByParent(document);
	const visited = new Set<NodeId>();
	const pages: Manifest['pages'] = [];
	for (const page of groups.get(null) ?? []) {
		const file = `pages/${fileSafe(page.id)}.json`;
		pages.push({ id: page.id, file });
		entries.push(jsonEntry(file, { nodes: depthFirst(page, groups, visited) }));
	}
	const orphans = Object.values(document.nodes)
		.filter((node) => !visited.has(node.id))
		.sort((left, right) => compareText(left.id, right.id));
	if (orphans.length > 0) entries.push(jsonEntry('orphans.json', { nodes: orphans }));

	const embedded = [...fonts].sort(
		(left, right) => compareText(left.family, right.family) || compareText(left.style, right.style)
	);
	const manifest: Manifest = {
		format: ARCHIVE_FORMAT,
		formatVersion: ARCHIVE_VERSION,
		schemaVersion: document.schemaVersion,
		id: document.id,
		name: document.name,
		pages,
		fonts: document.fonts,
		embeddedFonts: embedded.map((font, index) => ({
			family: font.family,
			style: font.style,
			file: fontFileName(index)
		}))
	};
	entries.push(jsonEntry('manifest.json', manifest));
	entries.push(jsonEntry('styles.json', sortedRecord(document.styles)));
	entries.push(
		jsonEntry('variables.json', {
			collections: sortedRecord(document.variableCollections),
			variables: sortedRecord(document.variables)
		})
	);
	entries.push(jsonEntry('assets.json', sortedRecord(document.assets)));
	for (const record of Object.values(document.assets)) {
		const bytes = imageBytes.get(record.id);
		if (bytes === undefined) continue;
		entries.push({ path: `assets/${record.id}.${extensionOf(record.mime)}`, bytes });
	}
	embedded.forEach((font, index) => {
		entries.push({ path: fontFileName(index), bytes: font.bytes });
	});
	return entries;
}

// ---------- reading ----------

function textOf(entries: Map<string, Uint8Array>, path: string): string {
	const bytes = entries.get(path);
	if (bytes === undefined) throw new ArchiveError(`the archive has no ${path}`);
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function jsonOf(entries: Map<string, Uint8Array>, path: string): unknown {
	try {
		return JSON.parse(textOf(entries, path));
	} catch (error) {
		if (error instanceof ArchiveError) throw error;
		throw new ArchiveError(`${path} is not valid JSON`);
	}
}

function recordOf(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new ArchiveError(`${path} must hold an object`);
	}
	return value as Record<string, unknown>;
}

function readManifest(entries: Map<string, Uint8Array>): Manifest {
	const manifest = recordOf(jsonOf(entries, 'manifest.json'), 'manifest.json');
	if (manifest.format !== ARCHIVE_FORMAT) {
		throw new ArchiveError('this is not a design archive (wrong format marker)');
	}
	if (manifest.formatVersion !== ARCHIVE_VERSION) {
		throw new ArchiveError(`unsupported archive version ${String(manifest.formatVersion)}`);
	}
	if (manifest.schemaVersion !== SCHEMA_VERSION) {
		throw new ArchiveError(
			`the archive uses document schema ${String(manifest.schemaVersion)}, this app reads ${SCHEMA_VERSION}`
		);
	}
	return manifest as unknown as Manifest;
}

function readNodes(
	entries: Map<string, Uint8Array>,
	path: string,
	into: Record<NodeId, Node>
): void {
	const file = recordOf(jsonOf(entries, path), path);
	if (!Array.isArray(file.nodes)) throw new ArchiveError(`${path} has no nodes list`);
	for (const node of file.nodes as Node[]) {
		if (typeof node !== 'object' || node === null || typeof node.id !== 'string') {
			throw new ArchiveError(`${path} holds something that is not a node`);
		}
		if (Object.hasOwn(into, node.id)) {
			throw new ArchiveError(`node ${node.id} appears more than once`);
		}
		into[node.id] = node;
	}
}

function assembleDocument(entries: Map<string, Uint8Array>, manifest: Manifest): DesignDocument {
	const nodes: Record<NodeId, Node> = {};
	if (!Array.isArray(manifest.pages)) throw new ArchiveError('manifest.json lists no pages');
	for (const page of manifest.pages) readNodes(entries, page.file, nodes);
	if (entries.has('orphans.json')) readNodes(entries, 'orphans.json', nodes);
	const variables = recordOf(jsonOf(entries, 'variables.json'), 'variables.json');
	return {
		schemaVersion: manifest.schemaVersion,
		id: manifest.id,
		name: manifest.name,
		nodes,
		styles: recordOf(jsonOf(entries, 'styles.json'), 'styles.json'),
		variableCollections: recordOf(variables.collections, 'variables.json collections'),
		variables: recordOf(variables.variables, 'variables.json variables'),
		assets: recordOf(jsonOf(entries, 'assets.json'), 'assets.json'),
		fonts: manifest.fonts
	} as DesignDocument;
}

function imagesOf(
	entries: Map<string, Uint8Array>,
	document: DesignDocument
): Pick<ArchiveContents, 'images' | 'missingImages'> {
	const byHash = new Map<string, Uint8Array>();
	for (const [path, bytes] of entries) {
		if (!path.startsWith('assets/')) continue;
		const name = path.slice('assets/'.length);
		const dot = name.lastIndexOf('.');
		byHash.set(dot < 0 ? name : name.slice(0, dot), bytes);
	}
	const images: ArchiveImage[] = [];
	const missingImages: string[] = [];
	for (const record of Object.values(document.assets)) {
		const bytes = byHash.get(record.id);
		if (bytes === undefined) {
			missingImages.push(record.id);
			continue;
		}
		const image: ArchiveImage = { hash: record.id, mime: record.mime, bytes };
		if (record.width !== undefined) image.width = record.width;
		if (record.height !== undefined) image.height = record.height;
		images.push(image);
	}
	return { images, missingImages };
}

function fontsOf(entries: Map<string, Uint8Array>, manifest: Manifest): ArchiveFont[] {
	const fonts: ArchiveFont[] = [];
	for (const listed of manifest.embeddedFonts ?? []) {
		const bytes = entries.get(listed.file);
		if (bytes === undefined) throw new ArchiveError(`the archive has no ${listed.file}`);
		fonts.push({ family: listed.family, style: listed.style, bytes });
	}
	return fonts;
}

/**
 * Read an archive back. Throws `ArchiveError` (with a readable reason) for a wrong format, an
 * unknown version, a missing file, or a document the schema validators refuse.
 */
export function parseArchive(files: readonly ArchiveEntry[]): ArchiveContents {
	const entries = new Map(files.map((file) => [file.path, file.bytes]));
	const manifest = readManifest(entries);
	const assembled = assembleDocument(entries, manifest);
	const parsed = parseDesignDocument(assembled);
	if (!parsed.ok) {
		throw new ArchiveError(`the archive holds an invalid document: ${parsed.message}`);
	}
	return {
		document: parsed.value,
		...imagesOf(entries, parsed.value),
		fonts: fontsOf(entries, manifest)
	};
}
