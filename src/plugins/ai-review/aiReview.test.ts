import { afterEach, describe, expect, it } from 'vitest';
import { applyChanges, aiProviders, createOps, setupAi } from '../../lib/ai/fixtures/aiFixture';
import { describePlugin, type MountedPlugin } from '../../lib/kernel/testing';
import aiReview from './index';

let current: MountedPlugin | undefined;

afterEach(async () => {
	await current?.cleanup();
	current = undefined;
});

describePlugin('ai-review', aiReview, {
	providers: aiProviders(),
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.aiReview.pending()).toEqual([]);
		expect(ctx.commands.has('ai-review.accept')).toBe(true);
		expect(ctx.commands.has('ai-review.reject')).toBe(true);
		expect(ctx.commands.has('ai-review.toggle')).toBe(true);
	}
});

async function setupReview(
	script: Parameters<typeof setupAi>[1],
	config: unknown = { reviewMode: true }
): Promise<Awaited<ReturnType<typeof setupAi>>> {
	const setup = await setupAi(aiReview, script, { config });
	current = setup.mounted;
	return setup;
}

describe('review mode', () => {
	it('keeps edits without asking by default', async () => {
		const { ctx } = await setupReview((turn) => applyChanges(turn, createOps(2)), {});
		await ctx.ai.run('Two cards').finished;
		expect(ctx.aiReview.enabled).toBe(false);
		expect(ctx.aiReview.pending()).toEqual([]);
	});

	it('holds a finished run, and accept keeps it', async () => {
		const { ctx } = await setupReview((turn) => applyChanges(turn, createOps(2)));
		await ctx.ai.run('Two cards').finished;
		expect(ctx.aiReview.pending()).toHaveLength(1);
		expect(ctx.aiReview.pendingNodeIds()).toHaveLength(2);
		ctx.aiReview.acceptAll();
		expect(ctx.aiReview.pending()).toEqual([]);
		expect(ctx.document.query((node) => node.name.startsWith('Card'))).toHaveLength(2);
	});

	it('reject restores the exact previous document', async () => {
		const { ctx } = await setupReview(async (turn) => {
			await applyChanges(turn, createOps(3));
			await applyChanges(turn, [{ op: 'set', id: 'a', props: { name: 'Renamed' } }]);
			await applyChanges(turn, [{ op: 'delete', id: 'b' }]);
		});
		const before = structuredClone(ctx.document.snapshot);
		await ctx.ai.run('Mess about').finished;
		expect(ctx.document.snapshot).not.toEqual(before);
		ctx.aiReview.rejectAll();
		expect(ctx.document.snapshot).toEqual(before);
		expect(ctx.aiReview.pending()).toEqual([]);
	});

	it('rejects the newest of two held runs and leaves the first', async () => {
		let round = 0;
		const { ctx } = await setupReview(async (turn) => {
			round += 1;
			await applyChanges(turn, createOps(1, `Round${round}`));
		});
		await ctx.ai.run('First').finished;
		await ctx.ai.run('Second').finished;
		expect(ctx.aiReview.pending()).toHaveLength(2);
		const newest = ctx.aiReview.pending()[1].runId;
		ctx.aiReview.reject(newest);
		expect(ctx.document.query((node) => node.name.startsWith('Round1'))).toHaveLength(1);
		expect(ctx.document.query((node) => node.name.startsWith('Round2'))).toHaveLength(0);
		expect(ctx.aiReview.pending()).toHaveLength(1);
	});

	it('drops a run the user undid and the toggle command flips the mode', async () => {
		const { ctx } = await setupReview((turn) => applyChanges(turn, createOps(1)));
		await ctx.ai.run('One').finished;
		ctx.history.undo();
		expect(ctx.aiReview.pending()).toEqual([]);
		await ctx.commands.run('ai-review.toggle');
		expect(ctx.aiReview.enabled).toBe(false);
	});
});
