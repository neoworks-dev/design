import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { aiProviders, setupAi } from '../../lib/ai/fixtures/aiFixture';
import type { FakeScript } from '../../lib/ai/fakeMain';
import { collectRenameCandidates, hasDefaultName } from '../../lib/ai/rename';
import type { DesignDocument } from '../../lib/document';
import { buildDocument, frame, node, page, rectangle, text } from '../../lib/document/fixtures';
import { describePlugin, type MountedPlugin } from '../../lib/kernel/testing';
import corePanels from '../core-panels';
import aiRename from './index';

function fixtureDocument(): DesignDocument {
	return buildDocument([
		page(
			'Page',
			[
				frame({ id: 'card', name: 'Frame 3', width: 200, height: 100 }, [
					rectangle({ id: 'plain', name: 'Rectangle' }),
					rectangle({ id: 'numbered', name: 'Rectangle 12' }),
					rectangle({ id: 'named', name: 'Hero image' }),
					rectangle({ id: 'hidden', name: 'Rectangle 2', visible: false }),
					rectangle({ id: 'locked', name: 'Rectangle 5', locked: true }),
					node('VECTOR', { id: 'vector', name: 'Vector' }),
					node('FRAME', { id: 'copy', name: 'Frame', componentRef: 'main' }, [
						rectangle({ id: 'inside', name: 'Rectangle 9', componentRef: 'main-inner' })
					]),
					text({ id: 'label', name: 'Text' })
				]),
				node('FRAME', { id: 'main', name: 'Frame 8' })
			],
			{ id: 'p' }
		)
	]);
}

let current: MountedPlugin | undefined;
afterEach(async () => {
	await current?.cleanup();
	current = undefined;
});

async function setup(script: FakeScript): Promise<Context> {
	const result = await setupAi(aiRename, script, {
		providers: aiProviders([corePanels], fixtureDocument())
	});
	current = result.mounted;
	return result.ctx;
}

describePlugin('ai-rename', aiRename, {
	providers: aiProviders([corePanels], fixtureDocument()),
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.commands.has('ai-rename.run')).toBe(true);
		expect(ctx.ai.tools.has('rename_layers')).toBe(true);
		ctx.selection.select(['card']);
		expect(ctx.menus.resolve('context/actions').map((item) => item.id)).toContain('ai-rename.run');
		expect(ctx.menus.resolve('context/canvas').map((item) => item.id)).toContain('actions');
		ctx.selection.clear();
	}
});

describe('which layers are candidates', () => {
	it('recognises default names with and without a number', () => {
		const document = fixtureDocument();
		expect(hasDefaultName(document.nodes.plain)).toBe(true);
		expect(hasDefaultName(document.nodes.numbered)).toBe(true);
		expect(hasDefaultName(document.nodes.card)).toBe(true);
		expect(hasDefaultName(document.nodes.named)).toBe(false);
	});

	it('skips hidden, locked, instance and vector layers and everything inside them', async () => {
		const ctx = await setup(() => Promise.resolve());
		const ids = collectRenameCandidates(ctx.document, ['card']).map((entry) => entry.id);
		expect(ids).toEqual(['card', 'plain', 'numbered', 'label']);
	});
});

function renameScript(names: { id: string; name: string }[]): FakeScript {
	return async (turn) => {
		const result = await turn.callTool('rename_layers', { names });
		if (!result.ok) throw new Error(result.text);
	};
}

describe('rename layers', () => {
	it('renames only the default-named candidates even when the model returns more', async () => {
		const ctx = await setup(
			renameScript([
				{ id: 'card', name: 'Profile Card' },
				{ id: 'plain', name: 'Background' },
				{ id: 'named', name: 'Oops' },
				{ id: 'hidden', name: 'Oops' },
				{ id: 'locked', name: 'Oops' },
				{ id: 'vector', name: 'Oops' },
				{ id: 'inside', name: 'Oops' },
				{ id: 'main', name: 'Oops' },
				{ id: 'label', name: 'Title' }
			])
		);
		ctx.selection.select(['card']);
		const outcome = await ctx.aiRename.renameLayers();
		expect(outcome?.renamed.map((entry) => entry.id)).toEqual(['card', 'plain', 'label']);
		const names = Object.fromEntries(
			['card', 'plain', 'numbered', 'named', 'hidden', 'locked', 'vector', 'inside', 'main'].map(
				(id) => [id, ctx.document.get(id)?.name]
			)
		);
		expect(names).toEqual({
			card: 'Profile Card',
			plain: 'Background',
			numbered: 'Rectangle 12',
			named: 'Hero image',
			hidden: 'Rectangle 2',
			locked: 'Rectangle 5',
			vector: 'Vector',
			inside: 'Rectangle 9',
			main: 'Frame 8'
		});
		expect(outcome?.skipped.map((entry) => entry.id)).toEqual([
			'named',
			'hidden',
			'locked',
			'vector',
			'inside',
			'main'
		]);
	});

	it('is one undo step labelled with the run and attributed to the AI', async () => {
		const ctx = await setup(
			renameScript([
				{ id: 'card', name: 'Profile Card' },
				{ id: 'plain', name: 'Background' }
			])
		);
		ctx.selection.select(['card']);
		const before = ctx.history.entries.length;
		await ctx.aiRename.renameLayers();
		expect(ctx.history.entries).toHaveLength(before + 1);
		expect(ctx.history.entries.at(-1)).toMatchObject({ origin: 'ai', label: 'Rename layers' });
		ctx.history.undo();
		expect(ctx.document.get('card')?.name).toBe('Frame 3');
		expect(ctx.document.get('plain')?.name).toBe('Rectangle');
	});

	it('refuses the tool in a run that was not a rename task', async () => {
		const ctx = await setup(renameScript([{ id: 'plain', name: 'Sneaky' }]));
		await expect(ctx.ai.run('Do something').finished).resolves.toBeDefined();
		expect(ctx.document.get('plain')?.name).toBe('Rectangle');
	});

	it('reports nothing to do when every layer is named, and asks for consent when missing', async () => {
		const ctx = await setup(renameScript([]));
		ctx.selection.select(['named']);
		expect(await ctx.aiRename.renameLayers()).toBeUndefined();
		expect(ctx.aiRename.notice).toContain('already has a name');
		ctx.ai.revokeConsent(ctx.document.documentId);
		ctx.selection.select(['card']);
		expect(await ctx.aiRename.renameLayers()).toBeUndefined();
		expect(ctx.aiRename.notice).toContain('Allow the AI');
	});
});

describe('the missing names hint', () => {
	it('appears for a frame with default-named layers and can be dismissed', async () => {
		const ctx = await setup(() => Promise.resolve());
		expect(ctx.aiRename.suggestion).toBeUndefined();
		ctx.selection.select(['card']);
		expect(ctx.aiRename.suggestion).toEqual({ count: 4 });
		ctx.aiRename.dismiss();
		expect(ctx.aiRename.suggestion).toBeUndefined();
		ctx.selection.select(['plain']);
		expect(ctx.aiRename.suggestion).toBeUndefined();
	});
});
