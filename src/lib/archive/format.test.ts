import { describe, expect, it } from 'vitest';
import { readZip, writeZip } from '../../../electron/archive/zip';
import { richDocument } from '../../../electron/store/testDocument';
import type { DesignDocument } from '../document';
import {
	ARCHIVE_FORMAT,
	ArchiveError,
	buildArchive,
	fileSafe,
	parseArchive,
	stableJson,
	type ArchiveFont
} from './format';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const HASH = 'ab'.repeat(32);
const FONT: ArchiveFont = {
	family: 'Inter',
	style: 'Regular',
	bytes: new Uint8Array([0, 1, 0, 0])
};

function documentWithAssets(): DesignDocument {
	const document = richDocument();
	document.assets = { [HASH]: { id: HASH, mime: 'image/png', width: 4, height: 3 } };
	document.fonts = [{ family: 'Inter', style: 'Regular', source: 'embedded' }];
	return document;
}

function archiveOf(document: DesignDocument): ReturnType<typeof buildArchive> {
	return buildArchive(document, new Map([[HASH, PNG]]), [FONT]);
}

function replaceFile(
	entries: ReturnType<typeof buildArchive>,
	path: string,
	value: unknown
): ReturnType<typeof buildArchive> {
	return entries.map((entry) => {
		if (entry.path !== path) return entry;
		return { path, bytes: new TextEncoder().encode(JSON.stringify(value)) };
	});
}

interface ManifestFile {
	pages: Array<{ file: string }>;
}
interface NodesFile {
	nodes: Array<Record<string, unknown>>;
}

function fileJson<T = Record<string, unknown>>(
	entries: ReturnType<typeof buildArchive>,
	path: string
): T {
	const entry = entries.find((candidate) => candidate.path === path);
	if (entry === undefined) throw new Error(`no ${path}`);
	const parsed: unknown = JSON.parse(new TextDecoder().decode(entry.bytes));
	return parsed as T;
}

describe('archive layout', () => {
	it('has a manifest, one file per page, library files and the binary assets', () => {
		const paths = archiveOf(documentWithAssets())
			.map((entry) => entry.path)
			.sort();
		expect(paths).toContain('manifest.json');
		expect(paths).toContain('styles.json');
		expect(paths).toContain('variables.json');
		expect(paths).toContain('assets.json');
		expect(paths).toContain(`assets/${HASH}.png`);
		expect(paths).toContain('fonts/0000.font');
		expect(paths.filter((path) => path.startsWith('pages/'))).toHaveLength(3);
		expect(fileJson(archiveOf(documentWithAssets()), 'manifest.json').format).toBe(ARCHIVE_FORMAT);
	});

	it('lists a page depth first with children in index order', () => {
		const document = documentWithAssets();
		const entries = archiveOf(document);
		const manifest = fileJson<ManifestFile>(entries, 'manifest.json');
		const home = fileJson<{ nodes: Array<{ name: string }> }>(entries, manifest.pages[0].file);
		expect(home.nodes.map((node) => node.name)).toEqual([
			'Home',
			'Hero',
			'Background',
			'Title',
			'Badges',
			'Badge 1',
			'Badge 2',
			'Footer'
		]);
	});

	it('makes ids file-name safe without collisions', () => {
		expect(fileSafe('page-1_a')).toBe('page-1_a');
		expect(fileSafe('a/b c')).toBe('a~2fb~20c');
		expect(fileSafe('a~b')).not.toBe(fileSafe('a/b'));
	});
});

describe('round trip', () => {
	it('is lossless for a document with every table, images and fonts', () => {
		const original = documentWithAssets();
		const contents = parseArchive(readZip(writeZip(archiveOf(original))));
		expect(contents.document).toEqual(JSON.parse(JSON.stringify(original)));
		expect(contents.images).toHaveLength(1);
		expect(contents.images[0]).toMatchObject({
			hash: HASH,
			mime: 'image/png',
			width: 4,
			height: 3
		});
		expect([...contents.images[0].bytes]).toEqual([...PNG]);
		expect(contents.fonts).toHaveLength(1);
		expect(contents.fonts[0]).toMatchObject({ family: 'Inter', style: 'Regular' });
		expect(contents.missingImages).toEqual([]);
	});

	it('keeps nodes no page reaches', () => {
		const original = documentWithAssets();
		const template = Object.values(original.nodes).find((node) => node.type === 'RECTANGLE');
		if (template === undefined) throw new Error('fixture changed');
		original.nodes['stray'] = {
			...template,
			id: 'stray',
			parentId: 'nowhere',
			name: 'Stray'
		};
		const contents = parseArchive(archiveOf(original));
		expect(contents.document.nodes['stray'].name).toBe('Stray');
	});

	it('reports assets whose bytes are not in the archive', () => {
		const entries = buildArchive(documentWithAssets(), new Map(), []);
		const contents = parseArchive(entries);
		expect(contents.missingImages).toEqual([HASH]);
		expect(contents.images).toEqual([]);
	});
});

describe('determinism', () => {
	it('gives byte-identical zips for the same document', () => {
		const first = writeZip(archiveOf(documentWithAssets()));
		const second = writeZip(archiveOf(documentWithAssets()));
		expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
	});

	it('does not depend on key or node insertion order', () => {
		const original = documentWithAssets();
		const shuffled: DesignDocument = {
			...original,
			nodes: Object.fromEntries(
				Object.entries(original.nodes)
					.reverse()
					.map(([id, node]) => [id, reorderKeys(node)])
			)
		};
		const a = writeZip(archiveOf(original));
		const b = writeZip(archiveOf(shuffled));
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
	});

	it('writes sorted keys, two-space indent and a trailing newline', () => {
		expect(stableJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
			'{\n  "a": {\n    "c": null,\n    "d": [\n      3,\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n'
		);
	});

	it('a change to one node changes only that page file', () => {
		const original = documentWithAssets();
		const changed = documentWithAssets();
		const target = Object.values(changed.nodes).find((node) => node.name === 'Old');
		if (target === undefined) throw new Error('fixture changed');
		target.name = 'Renamed';
		const before = new Map(archiveOf(original).map((entry) => [entry.path, entry.bytes]));
		const differing = archiveOf(changed)
			.filter(
				(entry) => !Buffer.from(before.get(entry.path) ?? []).equals(Buffer.from(entry.bytes))
			)
			.map((entry) => entry.path);
		expect(differing).toHaveLength(1);
		expect(differing[0]).toMatch(/^pages\//);
	});
});

function reorderKeys<T extends object>(value: T): T {
	const reversed = Object.fromEntries(Object.entries(value).reverse());
	return Object.assign(Object.create(null), reversed);
}

describe('validation', () => {
	it('refuses a zip that is not a design archive', () => {
		const entries = replaceFile(archiveOf(documentWithAssets()), 'manifest.json', { format: 'x' });
		expect(() => parseArchive(entries)).toThrow(/not a design archive/);
	});

	it('refuses a newer document schema than the app reads', () => {
		const entries = archiveOf(documentWithAssets());
		const manifest = fileJson(entries, 'manifest.json');
		const changed = replaceFile(entries, 'manifest.json', { ...manifest, schemaVersion: 99 });
		expect(() => parseArchive(changed)).toThrow(/schema 99/);
	});

	it('refuses an unknown archive version', () => {
		const entries = archiveOf(documentWithAssets());
		const manifest = fileJson(entries, 'manifest.json');
		const changed = replaceFile(entries, 'manifest.json', { ...manifest, formatVersion: 7 });
		expect(() => parseArchive(changed)).toThrow(/version 7/);
	});

	it('names a missing file', () => {
		const entries = archiveOf(documentWithAssets()).filter((entry) => entry.path !== 'styles.json');
		expect(() => parseArchive(entries)).toThrow(/no styles.json/);
	});

	it('runs the schema validators: a damaged node is refused with a reason', () => {
		const entries = archiveOf(documentWithAssets());
		const manifest = fileJson<ManifestFile>(entries, 'manifest.json');
		const page = fileJson<NodesFile>(entries, manifest.pages[0].file);
		page.nodes[1].width = 'wide';
		const changed = replaceFile(entries, manifest.pages[0].file, page);
		expect(() => parseArchive(changed)).toThrow(ArchiveError);
		expect(() => parseArchive(changed)).toThrow(/invalid document/);
	});

	it('refuses the same node in two files and invalid JSON', () => {
		const entries = archiveOf(documentWithAssets());
		const manifest = fileJson<ManifestFile>(entries, 'manifest.json');
		const page = fileJson(entries, manifest.pages[0].file);
		const duplicated = replaceFile(entries, manifest.pages[1].file, page);
		expect(() => parseArchive(duplicated)).toThrow(/more than once/);

		const broken = entries.map((entry) =>
			entry.path === 'styles.json'
				? { path: entry.path, bytes: new TextEncoder().encode('{') }
				: entry
		);
		expect(() => parseArchive(broken)).toThrow(/not valid JSON/);
	});
});
