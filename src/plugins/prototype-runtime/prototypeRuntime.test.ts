import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDocument, frame, page, rectangle } from '../../lib/document/fixtures';
import { at, editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import corePanels from '../core-panels';
import prototypePanel from '../prototype-panel';
import spatial from '../spatial';
import prototypeRuntime from './index';

const headlessRenderer: Plugin = {
	name: 'headlessRenderer',
	apply(ctx: Context): void {
		ctx.provide('headlessRenderer', {
			exportNode: (id: string) =>
				Promise.resolve({
					bytes: new Uint8Array([1, 2, 3]),
					width: 1,
					height: 1,
					format: 'PNG',
					mimeType: `image/png;id=${id}`
				})
		});
	}
};

function scene(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page(
			'Page',
			[
				frame({ id: 'home', name: 'Home', transform: at(0, 0), width: 100, height: 100 }, [
					rectangle({
						id: 'go',
						transform: at(10, 10),
						width: 40,
						height: 20,
						reactions: [
							{
								trigger: { type: 'ON_CLICK' },
								actions: [{ type: 'NODE', destinationId: 'detail', navigation: 'NAVIGATE' }]
							}
						]
					}),
					rectangle({
						id: 'key',
						transform: at(10, 40),
						width: 40,
						height: 20,
						reactions: [
							{
								trigger: { type: 'ON_KEY_DOWN', device: 'KEYBOARD', keyCodes: [32] },
								actions: [{ type: 'NODE', destinationId: 'third', navigation: 'NAVIGATE' }]
							}
						]
					})
				]),
				frame({ id: 'detail', name: 'Detail', transform: at(200, 0), width: 100, height: 100 }, [
					rectangle({
						id: 'back',
						width: 40,
						height: 20,
						reactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'BACK' }] }]
					})
				]),
				frame({ id: 'third', name: 'Third', transform: at(400, 0), width: 100, height: 100 })
			],
			{ id: 'p' }
		)
	]);
}

function providers(): Plugin[] {
	return [...editingProviders(scene()), corePanels, prototypePanel, spatial, headlessRenderer];
}

describePlugin('prototype-runtime', prototypeRuntime, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.prototypePlayer).toBeDefined();
		expect(ctx.prototypePlayer.view).toBeDefined();
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountRuntime(): Promise<Context> {
	mounted = await mountPlugin(prototypeRuntime, { providers: providers() });
	return mounted.ctx;
}

describe('player sessions', () => {
	it('starts at the selection, else the first flow, else the first frame', async () => {
		const ctx = await mountRuntime();
		expect(ctx.prototypePlayer.defaultStart([])).toBe('home');
		ctx.prototyping.addFlow('detail');
		expect(ctx.prototypePlayer.defaultStart([])).toBe('detail');
		expect(ctx.prototypePlayer.defaultStart(['back'])).toBe('detail');
		expect(ctx.prototypePlayer.defaultStart(['go'])).toBe('home');
	});

	it('clicks through the fixture prototype with synthetic input', async () => {
		const ctx = await mountRuntime();
		const session = ctx.prototypePlayer.createSession('home');

		expect(session.fire('go', 'ON_HOVER')).toBe(false);
		expect(session.fire('go', 'ON_CLICK')).toBe(true);
		expect(session.current).toBe('detail');
		expect(session.lastChange).toMatchObject({ change: { from: 'home', to: 'detail' } });

		expect(session.fire('back', 'ON_CLICK')).toBe(true);
		expect(session.current).toBe('home');

		expect(session.fire('key', 'ON_KEY_DOWN', 13)).toBe(false);
		expect(session.fire('key', 'ON_KEY_DOWN', 32)).toBe(true);
		expect(session.current).toBe('third');

		session.restart();
		expect(session.current).toBe('home');
		session.dispose();
	});

	it('steps between neighbouring frames with the arrow keys, connected or not', async () => {
		const ctx = await mountRuntime();
		const session = ctx.prototypePlayer.createSession('home');
		session.stepFrame(1);
		session.stepFrame(1);
		expect(session.current).toBe('third');
		session.stepFrame(1);
		expect(session.current).toBe('third');
		session.stepFrame(-1);
		expect(session.current).toBe('detail');
		session.dispose();
	});

	it('renders each frame once and releases its pictures on dispose', async () => {
		const ctx = await mountRuntime();
		const session = ctx.prototypePlayer.createSession('home');
		const first = await session.frame('home');
		expect(await session.frame('home')).toBe(first);
		expect(first.layers).toHaveLength(1);
		expect(first.hotspots.map((spot) => spot.nodeId).sort()).toEqual(['go', 'key']);
		session.dispose();
	});
});
