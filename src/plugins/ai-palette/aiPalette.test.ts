import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import type { FakeScript } from '../../lib/ai/fakeMain';
import { aiProviders, setupAi, taskScript, type AiSetup } from '../../lib/ai/fixtures/aiFixture';
import { PALETTE_TOOLS } from '../../lib/services/aiPalette';
import { describePlugin, type MountedPlugin } from '../../lib/kernel/testing';
import align from '../align';
import aiContext from '../ai-context';
import commandPalette from '../command-palette';
import corePanels from '../core-panels';
import aiPalette from './index';

function providers(): Plugin[] {
	return aiProviders([corePanels, commandPalette, aiContext, align]);
}

let current: MountedPlugin | undefined;
afterEach(async () => {
	await current?.cleanup();
	current = undefined;
});

async function setup(script: FakeScript = taskScript()): Promise<AiSetup> {
	const result = await setupAi(aiPalette, script, { providers: providers() });
	current = result.mounted;
	return result;
}

function positionsOf(ctx: Context, ids: string[]): number[] {
	return ids.map((id) => {
		const node = ctx.document.get(id);
		return node !== undefined && node.type !== 'PAGE' ? node.transform[0][2] : Number.NaN;
	});
}

describePlugin('ai-palette', aiPalette, {
	providers: providers(),
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.palette.sourceList().map((source) => source.id)).toContain('ask-ai');
		expect(ctx.commands.has('ai-palette.open')).toBe(true);
	}
});

describe('natural language in the palette', () => {
	it('runs "align these to left" as the align command through the tools', async () => {
		const { ctx } = await setup();
		ctx.selection.select(['a', 'b', 'c']);
		expect(positionsOf(ctx, ['a', 'b', 'c'])).toEqual([0, 20, 40]);
		const steps = ctx.history.entries.length;
		const status = await ctx.aiPalette.ask('align these to left');
		expect(status).toBe('done');
		expect(positionsOf(ctx, ['a', 'b', 'c'])).toEqual([0, 0, 0]);
		expect(ctx.aiPalette.answer).toBe('Ran align.left.');
		expect(ctx.history.entries).toHaveLength(steps + 1);
		expect(ctx.history.entries.at(-1)).toMatchObject({ origin: 'ai' });
		ctx.history.undo();
		expect(positionsOf(ctx, ['a', 'b', 'c'])).toEqual([0, 20, 40]);
	});

	it('is limited to commands: the model sees only the command and read tools', async () => {
		const { ctx, main } = await setup();
		ctx.selection.select(['a', 'b']);
		await ctx.aiPalette.ask('align these to left');
		const offered = main.started[0].tools.map((tool) => tool.name).sort();
		expect(offered).toEqual([...PALETTE_TOOLS].sort());
		expect(offered).not.toContain('apply_changes');
		expect(offered).not.toContain('set_props');
	});

	it('refuses a tool outside the list even when the model calls it', async () => {
		let answer = { ok: true, text: '' };
		const { ctx } = await setup(async (turn) => {
			answer = await turn.callTool('apply_changes', {
				ops: [{ op: 'delete', id: 'a' }]
			});
		});
		await ctx.aiPalette.ask('delete everything');
		expect(answer).toMatchObject({ ok: false, text: expect.stringContaining('not available') });
		expect(ctx.document.get('a')).toBeDefined();
	});

	it('says so when no command fits and changes nothing', async () => {
		const { ctx } = await setup();
		ctx.selection.select(['a']);
		const revision = ctx.document.revision;
		await ctx.aiPalette.ask('make me a sandwich');
		expect(ctx.aiPalette.answer).toBe('I could not find a command for that.');
		expect(ctx.document.revision).toBe(revision);
	});

	it('offers the request as the palette row and runs it', async () => {
		const { ctx } = await setup();
		ctx.selection.select(['a', 'b', 'c']);
		ctx.palette.open('ask-ai');
		expect(ctx.palette.rows()).toEqual([]);
		ctx.palette.setQuery('align these to left');
		const rows = ctx.palette.rows();
		expect(rows.map((row) => row.item.title)).toEqual(['Ask AI: “align these to left”']);
		await ctx.palette.runSelected();
		await expect.poll(() => ctx.aiPalette.answer).toBe('Ran align.left.');
		expect(positionsOf(ctx, ['a', 'b', 'c'])).toEqual([0, 0, 0]);
	});

	it('asks for consent first', async () => {
		const { ctx } = await setup();
		ctx.ai.revokeConsent(ctx.document.documentId);
		expect(await ctx.aiPalette.ask('align these to left')).toBeUndefined();
		expect(ctx.aiPalette.answer).toContain('Allow the AI');
	});
});
