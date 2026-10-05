import { describe, expect, it } from 'vitest';
import { buildDocument, page, rectangle } from '../document/fixtures';
import { designDocumentSchema } from '../document/schema';
import {
	MAX_PLUGIN_DATA_ENTRY_BYTES,
	privateNamespace,
	readEntry,
	readRelaunchData,
	sharedNamespace,
	withEntry,
	withRelaunchData
} from './pluginData';

describe('plugin data', () => {
	it('sets, reads and removes entries without touching other namespaces', () => {
		const start = { comments: { a: '1' } };
		const set = withEntry(start, privateNamespace('demo'), 'k', 'v');
		expect(set).toEqual({ comments: { a: '1' }, 'plugin:demo': { k: 'v' } });
		expect(readEntry(set, privateNamespace('demo'), 'k')).toBe('v');
		expect(readEntry(set, privateNamespace('other'), 'k')).toBe('');
		expect(withEntry(set, privateNamespace('demo'), 'k', '')).toEqual(start);
		expect(start).toEqual({ comments: { a: '1' } });
	});

	it('refuses an entry over 100 kB, counting bytes not characters', () => {
		const namespace = privateNamespace('demo');
		const exactly = 'x'.repeat(MAX_PLUGIN_DATA_ENTRY_BYTES - 1);
		expect(() => withEntry({}, namespace, 'k', exactly)).not.toThrow();
		expect(() => withEntry({}, namespace, 'k', `${exactly}x`)).toThrow(/larger than 100 kB/);
		expect(() => withEntry({}, namespace, 'k', 'é'.repeat(60_000))).toThrow(/larger than 100 kB/);
	});

	it('validates shared namespaces and keeps them apart from private ones', () => {
		expect(sharedNamespace('palette')).toBe('shared:palette');
		expect(() => sharedNamespace('ab')).toThrow(/not a valid namespace/);
		expect(sharedNamespace('comments')).not.toBe('comments');
	});

	it('round trips relaunch data and clears it when empty', () => {
		const set = withRelaunchData({}, 'demo', { 'demo.edit': 'Edit' });
		expect(readRelaunchData(set, 'demo')).toEqual({ 'demo.edit': 'Edit' });
		expect(withRelaunchData(set, 'demo', {})).toEqual({});
	});

	it('survives a save and load of the document (the file schema)', () => {
		const document = buildDocument([page('Page', [rectangle({ name: 'Card' })])]);
		const [pageNode] = Object.values(document.nodes).filter((node) => node.name === 'Card');
		const data = withEntry(pageNode.pluginData, sharedNamespace('palette'), 'primary', 'blue');
		const edited = {
			...document,
			nodes: { ...document.nodes, [pageNode.id]: { ...pageNode, pluginData: data } }
		};
		const reloaded = designDocumentSchema.parse(JSON.parse(JSON.stringify(edited)));
		expect(reloaded.nodes[pageNode.id].pluginData).toEqual({
			'shared:palette': { primary: 'blue' }
		});
	});
});
