import type { Context, Plugin } from '@neoworks/extension-system';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import type { SceneSource } from '../../lib/renderer/sceneSource';
import { isFixtureEnabled } from './enabled';
import { FIRST_PAGE_ID, SECOND_PAGE_ID } from './fixture';
import sceneFixture from './index';

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

// A renderer stand-in that only records which source it was given.
function fakeRenderer(received: SceneSource[]): Plugin {
	return {
		name: 'fake-renderer',
		inject: [],
		apply(ctx: Context): void {
			ctx.provide('renderer', {
				setSceneSource(source: SceneSource): () => void {
					received.push(source);
					return () => {
						received.splice(received.indexOf(source), 1);
					};
				}
			});
		}
	} as Plugin;
}

describe('scene-fixture', () => {
	it('hands the fixture source to the renderer and removes it when unloaded', async () => {
		const received: SceneSource[] = [];
		mounted = await mountPlugin(sceneFixture, {
			providers: [fakeRenderer(received)],
			config: { enabled: true }
		});
		expect(received).toHaveLength(1);
		const source = received[0];
		expect(source.currentPageId()).toBe(FIRST_PAGE_ID);
		expect(source.children(FIRST_PAGE_ID)).toEqual(['frame-a', 'frame-b', 'frame-c']);
		expect(source.getNode('rect-red')?.type).toBe('RECTANGLE');
	});

	it('serves nothing when disabled', async () => {
		const received: SceneSource[] = [];
		mounted = await mountPlugin(sceneFixture, {
			providers: [fakeRenderer(received)],
			config: { enabled: false }
		});
		expect(received).toHaveLength(0);
		expect(Reflect.get(mounted.ctx, 'scene-fixture')).toBeUndefined();
	});

	it('lets QA switch pages and edit nodes, notifying subscribers', async () => {
		mounted = await mountPlugin(sceneFixture, {
			providers: [fakeRenderer([])],
			config: { enabled: true }
		});
		const { source } = mounted.ctx['scene-fixture'];
		const seen: string[] = [];
		source.subscribe((change) => seen.push(change.kind));
		source.showPage(SECOND_PAGE_ID);
		source.apply([{ t: 'set', id: 'rect-teal', set: { width: 50 }, prev: { width: 120 } }]);
		expect(source.currentPageId()).toBe(SECOND_PAGE_ID);
		expect(seen).toEqual(['reset', 'changes']);
	});
});

describe('when the fixture is served', () => {
	it('is on in dev and in a QA session, off in a plain production load', () => {
		expect(isFixtureEnabled({ dev: true, search: '' })).toBe(true);
		expect(isFixtureEnabled({ dev: false, search: '?qa=1' })).toBe(true);
		expect(isFixtureEnabled({ dev: false, search: '' })).toBe(false);
		expect(isFixtureEnabled({ dev: false, search: '?qa=0' })).toBe(false);
	});

	it('the plugin source gates serving on the environment check before touching the renderer', () => {
		const source = readFileSync(`${import.meta.dirname}/index.ts`, 'utf8');
		expect(source).toContain('isFixtureEnabled(currentEnvironment())');
		expect(source.indexOf('if (!isEnabled(config)) return;')).toBeLessThan(
			source.indexOf('ctx.renderer.setSceneSource')
		);
	});
});

describePlugin('scene-fixture', sceneFixture, {
	providers: [fakeRenderer([])],
	config: { enabled: true },
	contributes: ({ ctx }) => {
		expect(ctx['scene-fixture'].source.currentPageId()).toBe(FIRST_PAGE_ID);
	}
});
