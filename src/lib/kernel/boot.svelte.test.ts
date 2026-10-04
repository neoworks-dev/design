import { Context, Service } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import { bootKernel } from './boot.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		bootProbe: BootProbe;
	}
}

class BootProbe extends Service {
	constructor(ctx: Context) {
		super(ctx, 'bootProbe');
	}
}

const provider = {
	name: 'probe-provider',
	inject: [],
	apply(ctx: Context): void {
		new BootProbe(ctx);
	}
};

function recordingPlugin(
	name: string,
	activated: string[],
	inject: string[] = []
): { name: string; inject: string[]; apply: () => void } {
	return {
		name,
		inject,
		apply(): void {
			activated.push(name);
		}
	};
}

describe('bootKernel', () => {
	it('mounts every plugin and reports them active', async () => {
		const activated: string[] = [];
		const report = await bootKernel(new Context(), [
			recordingPlugin('one', activated),
			recordingPlugin('two', activated)
		]);
		expect(activated.sort()).toEqual(['one', 'two']);
		expect(report.records).toEqual([
			{ name: 'one', status: 'active' },
			{ name: 'two', status: 'active' }
		]);
		report.dispose();
	});

	it('does not stop other plugins when one throws in apply', async () => {
		const activated: string[] = [];
		const broken = {
			name: 'broken',
			inject: [],
			apply(): void {
				throw new Error('boom');
			}
		};
		const ctx = new Context();
		const report = await bootKernel(ctx, [
			recordingPlugin('before', activated),
			broken,
			recordingPlugin('after', activated)
		]);
		expect(activated.sort()).toEqual(['after', 'before']);
		expect(report.failures).toEqual([{ name: 'broken', status: 'failed', error: 'boom' }]);
		expect(report.records.filter((record) => record.status === 'active')).toHaveLength(2);
		report.dispose();
	});

	it('reports unsatisfied inject as pending, not failed, and activates when it arrives', async () => {
		const activated: string[] = [];
		const ctx = new Context();
		const report = await bootKernel(ctx, [
			recordingPlugin('needs-probe', activated, ['bootProbe'])
		]);
		expect(report.pending.map((record) => record.name)).toEqual(['needs-probe']);
		expect(report.failures).toEqual([]);

		await ctx.plugin(provider);
		await Promise.resolve();
		expect(report.pending).toEqual([]);
		expect(report.records[0]).toEqual({ name: 'needs-probe', status: 'active' });
		report.dispose();
	});

	it('does not depend on plugin order', async () => {
		const activated: string[] = [];
		const report = await bootKernel(new Context(), [
			recordingPlugin('needs-probe', activated, ['bootProbe']),
			provider
		]);
		await Promise.resolve();
		expect(activated).toEqual(['needs-probe']);
		expect(report.failures).toEqual([]);
		report.dispose();
	});

	it('retries a failed plugin through fiber.update', async () => {
		let attempts = 0;
		const flaky = {
			name: 'flaky',
			inject: [],
			apply(): void {
				attempts += 1;
				if (attempts === 1) throw new Error('first attempt fails');
			}
		};
		const report = await bootKernel(new Context(), [flaky]);
		expect(report.failures.map((record) => record.error)).toEqual(['first attempt fails']);

		await report.retryPlugin('flaky');
		expect(attempts).toBe(2);
		expect(report.records).toEqual([{ name: 'flaky', status: 'active' }]);
		report.dispose();
	});

	it('keeps a plugin failed when the retry fails again', async () => {
		const stubborn = {
			name: 'stubborn',
			inject: [],
			apply(): void {
				throw new Error('still broken');
			}
		};
		const report = await bootKernel(new Context(), [stubborn]);
		await report.retryPlugin('stubborn');
		expect(report.failures).toEqual([
			{ name: 'stubborn', status: 'failed', error: 'still broken' }
		]);
		report.dispose();
	});

	it('rejects retry for unknown names', async () => {
		const report = await bootKernel(new Context(), []);
		await expect(report.retryPlugin('missing')).rejects.toThrow('no plugin named "missing"');
		report.dispose();
	});

	it('reports a plugin that throws synchronously from ctx.plugin as failed', async () => {
		const report = await bootKernel(new Context(), [{ name: 'invalid' } as never]);
		expect(report.failures.map((record) => record.name)).toEqual(['invalid']);
		report.dispose();
	});

	it('follows later state changes of a tracked fiber', async () => {
		const ctx = new Context();
		const report = await bootKernel(ctx, [
			recordingPlugin('needs-probe', [], ['bootProbe']),
			provider
		]);
		await Promise.resolve();
		expect(report.records.map((record) => record.status)).toEqual(['active', 'active']);
		ctx.registry.delete(provider);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(report.records[0].status).toBe('pending');
		report.dispose();
	});
});
