import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentStore, type Node, type NodeId } from '../../lib/document';
import { emptyDocument } from '../../lib/document/fixtures';
import { planReflow } from '../../lib/layout/reflow';
import { mountPlugin, type MountedPlugin, type StateSnapshot } from '../../lib/kernel/testing';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import documentPlugin from '../document';
import { isFixtureEnabled } from './enabled';
import { buildFixtureDocument, FIRST_PAGE_ID, FIXTURE_FILE_ID } from './fixture';
import sceneFixture from './index';

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

const providers = [coreContextKeys, coreCommands, documentPlugin];

describe('scene-fixture', () => {
	it('loads the fixture into the document service and restores the old document when unloaded', async () => {
		mounted = await mountPlugin(sceneFixture, {
			providers,
			config: { enabled: true, startPage: FIRST_PAGE_ID }
		});
		const { ctx, fiber } = mounted;
		expect(ctx.document.documentId).toBe(FIXTURE_FILE_ID);
		expect(ctx.document.currentPageId).toBe(FIRST_PAGE_ID);
		expect(ctx.document.children(FIRST_PAGE_ID)).toEqual(['frame-a', 'frame-b', 'frame-c']);
		expect(ctx.document.get('rect-red')?.type).toBe('RECTANGLE');
		await fiber.dispose();
		expect(ctx.document.documentId).not.toBe(FIXTURE_FILE_ID);
	});

	it('leaves the document alone when disabled', async () => {
		mounted = await mountPlugin(sceneFixture, { providers, config: { enabled: false } });
		expect(mounted.ctx.document.documentId).not.toBe(FIXTURE_FILE_ID);
	});

	it('does not load itself again over a file the user opened', async () => {
		mounted = await mountPlugin(sceneFixture, {
			providers,
			config: { enabled: true, startPage: FIRST_PAGE_ID }
		});
		const { ctx } = mounted;
		const opened = emptyDocument();
		ctx.document.replaceDocument(opened);
		expect(ctx.document.documentId).toBe(opened.id);
		expect(ctx.document.get('image-fill')).toBeUndefined();
	});
});

describe('when the fixture is served', () => {
	it('is on in dev and in a QA session, off in a plain production load', () => {
		expect(isFixtureEnabled({ dev: true, search: '' })).toBe(true);
		expect(isFixtureEnabled({ dev: false, search: '?qa=1' })).toBe(true);
		expect(isFixtureEnabled({ dev: false, search: '' })).toBe(false);
		expect(isFixtureEnabled({ dev: false, search: '?qa=0' })).toBe(false);
	});

	it('the plugin source gates loading on the environment check before touching the document', () => {
		const source = readFileSync(`${import.meta.dirname}/index.ts`, 'utf8');
		expect(source).toContain('isFixtureEnabled(currentEnvironment())');
		expect(source.indexOf('if (!isEnabled(config)) return;')).toBeLessThan(
			source.indexOf('loadFixture(ctx, config);')
		);
	});
});

describe('unmounting', () => {
	it('leaves observable state identical, except the revision, which only ever increases', async () => {
		mounted = await mountPlugin(sceneFixture, {
			providers,
			config: { enabled: true, startPage: FIRST_PAGE_ID }
		});
		const { ctx, fiber, snapshot } = mounted;
		const revisionBefore = ctx.document.revision;
		await fiber.dispose();
		const after = mounted.currentState();
		expect(ctx.document.revision).toBeGreaterThan(revisionBefore);
		expect(withoutRevision(after)).toEqual(withoutRevision(snapshot));
	});
});

function withoutRevision(state: StateSnapshot): StateSnapshot {
	return { ...state, services: { ...state.services, document: {} } };
}

describe('auto layout frame of the fixture', () => {
	it('is stored exactly where the engine puts it', () => {
		const store = new DocumentStore(buildFixtureDocument());
		const source = {
			node: (id: NodeId): Node => store.requireNode(id),
			children: (id: NodeId): readonly NodeId[] => store.children(id),
			measureText: (): { width: number; height: number } => ({ width: 0, height: 0 })
		};
		expect(planReflow(store, source, 'frame-auto')).toEqual([]);
	});
});
