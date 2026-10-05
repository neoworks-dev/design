import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeScript } from '../../lib/ai/fakeMain';
import { aiProviders, setupAi } from '../../lib/ai/fixtures/aiFixture';
import { SearchIndex } from '../../lib/ai/searchIndex';
import type { DesignDocument } from '../../lib/document';
import { buildDocument, frame, node, page, rectangle, text } from '../../lib/document/fixtures';
import { describePlugin, type MountedPlugin } from '../../lib/kernel/testing';
import commandPalette from '../command-palette';
import corePanels from '../core-panels';
import aiSearch from './index';

function textWith(id: string, name: string, characters: string): ReturnType<typeof text> {
	return text({
		id,
		name,
		paragraphs: [{ runs: [{ text: characters, style: {} }], style: {} }]
	} as never);
}

function fixtureDocument(): DesignDocument {
	const document = buildDocument([
		page(
			'Home',
			[
				frame({ id: 'login', name: 'Login form' }, [
					textWith('heading', 'Heading', 'Welcome back'),
					rectangle({ id: 'email', name: 'Email field' }),
					rectangle({ id: 'cta', name: 'Primary Button' })
				]),
				frame({ id: 'hero', name: 'Hero' }, [
					rectangle({ id: 'photo', name: 'Hero image' }),
					textWith('tagline', 'Tagline', 'Design faster together')
				]),
				node('COMPONENT', { id: 'cardc', name: 'Card/Product', key: 'k1' })
			],
			{ id: 'page1' }
		),
		page('Pricing', [rectangle({ id: 'plan', name: 'Plan table' })], { id: 'page2' })
	]);
	document.styles.s1 = {
		id: 's1',
		type: 'PAINT',
		name: 'Brand blue',
		description: 'main accent color',
		value: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }]
	};
	return document;
}

const zoomToSelection = vi.fn();
const setAssetsQuery = vi.fn();

const fakeViewport: Plugin = {
	name: 'fake-viewport',
	apply(ctx) {
		ctx.provide('viewport', { zoomToSelection });
	}
};
const fakeAssetsPanel: Plugin = {
	name: 'fake-assets-panel',
	apply(ctx) {
		ctx.provide('assetsPanel', { setQuery: setAssetsQuery });
	}
};

function providers(): Plugin[] {
	return aiProviders(
		[corePanels, commandPalette, fakeViewport, fakeAssetsPanel],
		fixtureDocument()
	);
}

let current: MountedPlugin | undefined;
afterEach(async () => {
	await current?.cleanup();
	current = undefined;
	zoomToSelection.mockClear();
	setAssetsQuery.mockClear();
});

async function setup(script: FakeScript = () => Promise.resolve()): Promise<Context> {
	const result = await setupAi(aiSearch, script, { providers: providers() });
	current = result.mounted;
	return result.ctx;
}

describePlugin('ai-search', aiSearch, {
	providers: providers(),
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('ai-search.open')).toBe(true);
		expect(ctx.ai.tools.has('report_matches')).toBe(true);
		expect(ctx.palette.sourceList().map((source) => source.id)).toContain('ai-search');
	}
});

describe('local index', () => {
	it('finds layers by name, text, synonyms and structure', async () => {
		const ctx = await setup();
		const first = (query: string): string | undefined => ctx.aiSearch.search(query)[0]?.id;
		expect(first('login')).toBe('login');
		expect(first('btn')).toBe('cta');
		expect(first('picture')).toBe('photo');
		expect(first('welcome')).toBe('heading');
		expect(first('faster')).toBe('tagline');
		expect(first('product card')).toBe('cardc');
		expect(first('email')).toBe('email');
		expect(ctx.aiSearch.search('zebra')).toEqual([]);
	});

	it('uses the structure: a layer matches the name of its ancestors, less than its own', async () => {
		const ctx = await setup();
		const ids = ctx.aiSearch.search('login').map((result) => result.id);
		expect(ids[0]).toBe('login');
		expect(ids).toEqual(expect.arrayContaining(['heading', 'email', 'cta']));
		expect(ids).not.toContain('photo');
	});

	it('finds styles and marks components', async () => {
		const ctx = await setup();
		const styles = ctx.aiSearch.search('blue');
		expect(styles[0]).toMatchObject({ kind: 'style', id: 's1' });
		expect(ctx.aiSearch.search('accent color')[0]).toMatchObject({ kind: 'style' });
		expect(ctx.aiSearch.search('card')[0]).toMatchObject({ kind: 'component', id: 'cardc' });
	});

	it('follows edits: rename, create and delete show up without rebuilding', async () => {
		const ctx = await setup();
		expect(ctx.aiSearch.search('checkout')).toEqual([]);
		ctx.document.apply(ctx.document.setProps('plan', { name: 'Checkout summary' }), {
			origin: 'user',
			label: 'Rename'
		});
		expect(ctx.aiSearch.search('checkout')[0]?.id).toBe('plan');
		expect(ctx.aiSearch.search('plan table')).toEqual([]);
		ctx.document.apply(ctx.document.removeNode('plan'), { origin: 'user', label: 'Delete' });
		expect(ctx.aiSearch.search('checkout')).toEqual([]);
		ctx.history.undo();
		expect(ctx.aiSearch.search('checkout')[0]?.id).toBe('plan');
	});
});

describe('SearchIndex', () => {
	it('builds once and re-reads only the changed layers', () => {
		const document = fixtureDocument();
		let allIdsCalls = 0;
		const reads: string[] = [];
		const index = new SearchIndex({
			get: (id) => {
				reads.push(id);
				return document.nodes[id];
			},
			allIds: () => {
				allIdsCalls += 1;
				return Object.keys(document.nodes).filter((id) => document.nodes[id].type !== 'PAGE');
			}
		});
		index.update(['login']);
		expect(index.isBuilt).toBe(false);
		index.search('login');
		expect(allIdsCalls).toBe(1);
		expect(index.size).toBe(9);
		document.nodes.email.name = 'Password field';
		reads.length = 0;
		index.update(['email']);
		expect(index.search('password')[0]?.id).toBe('email');
		expect(allIdsCalls).toBe(1);
		expect(reads.filter((id) => id === 'photo')).toEqual([]);
	});
});

describe('picking', () => {
	it('selects a layer on its page and zooms to it; a style opens the assets panel', async () => {
		const ctx = await setup();
		const [plan] = ctx.aiSearch.search('plan table');
		ctx.aiSearch.pick(plan);
		expect(ctx.document.currentPageId).toBe('page2');
		expect(ctx.selection.ids).toEqual(['plan']);
		expect(zoomToSelection).toHaveBeenCalledTimes(1);
		const [style] = ctx.aiSearch.search('brand blue');
		ctx.aiSearch.pick(style);
		expect(setAssetsQuery).toHaveBeenCalledWith('Brand blue');
	});

	it('lists results in the palette tab without fuzzy filtering and runs the pick', async () => {
		const ctx = await setup();
		ctx.palette.open('ai-search');
		ctx.palette.setQuery('picture');
		const rows = ctx.palette.rows();
		expect(rows[0].item.title).toBe('Hero image');
		expect(rows.at(-1)?.item.id).toBe('ask-ai');
		await ctx.palette.runSelected();
		expect(ctx.selection.ids).toEqual(['photo']);
	});
});

describe('ask the AI', () => {
	function reportScript(ids: string[]): FakeScript {
		return async (turn) => {
			const result = await turn.callTool('report_matches', { ids });
			if (!result.ok) throw new Error(result.text);
		};
	}

	it('puts what the model reported first and ignores ids that were not candidates', async () => {
		const ctx = await setup(reportScript(['heading', 'not-a-candidate', 'heading', 'cta']));
		const before = ctx.aiSearch.search('sign in').map((result) => result.id);
		expect(before).not.toContain('heading');
		const results = await ctx.aiSearch.askAi('sign in');
		expect(results.map((result) => result.id)).toEqual(['heading', 'cta']);
		expect(results.every((result) => result.fromAi)).toBe(true);
		expect(
			ctx.aiSearch
				.search('sign in')
				.map((result) => result.id)
				.slice(0, 2)
		).toEqual(['heading', 'cta']);
		expect(ctx.aiSearch.search('something else')[0]?.fromAi).not.toBe(true);
	});

	it('runs read-only: the document does not change and no history step is added', async () => {
		const ctx = await setup(reportScript(['heading']));
		const steps = ctx.history.entries.length;
		const revision = ctx.document.revision;
		await ctx.aiSearch.askAi('sign in');
		expect(ctx.document.revision).toBe(revision);
		expect(ctx.history.entries).toHaveLength(steps);
		expect(ctx.ai.runs().at(-1)).toMatchObject({ scope: 'read', label: 'Find: sign in' });
	});

	it('asks for consent first', async () => {
		const ctx = await setup(reportScript(['heading']));
		ctx.ai.revokeConsent(ctx.document.documentId);
		expect(await ctx.aiSearch.askAi('sign in')).toEqual([]);
		expect(ctx.aiSearch.notice).toContain('Allow the AI');
	});
});
