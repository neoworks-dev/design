import { describe, expect, it } from 'vitest';
import selectionPlugin from '../../plugins/selection';
import coreContextKeys from '../../plugins/core-context-keys';
import { describePlugin, mountPlugin, type MountedPlugin } from '../kernel/testing';
import { documentWith, sampleDocument } from './fixtures/documentFixture';

const providers = [coreContextKeys, documentWith(sampleDocument())];
const user = { origin: 'user' as const, label: 'Test' };

describePlugin('selection', selectionPlugin, {
	providers,
	contributes: ({ ctx }) => {
		expect(ctx.selection.ids).toEqual([]);
		expect(ctx.contextKeys.get('hasSelection')).toBe(false);
		expect(ctx.contextKeys.get('selectionKind')).toBe('none');
	}
});

async function mount(): Promise<MountedPlugin> {
	return mountPlugin(selectionPlugin, {
		providers: [coreContextKeys, documentWith(sampleDocument())]
	});
}

function recordChanges(mounted: MountedPlugin): string[][] {
	const changes: string[][] = [];
	mounted.ctx.on('selection/change', (ids) => changes.push([...ids]));
	return changes;
}

describe('select', () => {
	it('replaces, adds, toggles and removes', async () => {
		const mounted = await mount();
		const { selection } = mounted.ctx;
		selection.select(['n3']);
		expect(selection.ids).toEqual(['n3']);
		selection.select(['n4'], 'add');
		expect(selection.ids).toEqual(['n3', 'n4']);
		selection.select(['n3', 'n6'], 'toggle');
		expect(selection.ids).toEqual(['n4', 'n6']);
		selection.select(['n4'], 'remove');
		expect(selection.ids).toEqual(['n6']);
		selection.clear();
		expect(selection.ids).toEqual([]);
		await mounted.cleanup();
	});

	it('fires selection/change once per change and not for no-ops', async () => {
		const mounted = await mount();
		const changes = recordChanges(mounted);
		const { selection } = mounted.ctx;
		selection.select(['n3', 'n4']);
		selection.select(['n3', 'n4']);
		selection.select(['n3'], 'add');
		selection.clear();
		selection.clear();
		expect(changes).toEqual([['n3', 'n4'], []]);
		await mounted.cleanup();
	});

	it('rejects unknown nodes, pages and nodes of another page', async () => {
		const mounted = await mount();
		const { selection } = mounted.ctx;
		expect(() => selection.select(['ghost'])).toThrow(/unknown node/);
		expect(() => selection.select(['n1'])).toThrow(/page/);
		expect(() => selection.select(['n8'])).toThrow(/current page/);
		expect(selection.ids).toEqual([]);
		await mounted.cleanup();
	});

	it('the canvas skips locked and hidden nodes (and their children), layers and API do not', async () => {
		const mounted = await mount();
		const { selection, document } = mounted.ctx;
		document.apply(document.setProps('n3', { locked: true }), user);
		document.apply(document.setProps('n4', { visible: false }), user);
		document.apply(document.setProps('n5', { locked: true }), user);
		selection.select(['n3', 'n4', 'n6', 'n2'], 'replace', { source: 'canvas' });
		expect(selection.ids).toEqual(['n2']);
		selection.select(['n3', 'n4', 'n6'], 'replace', { source: 'layers' });
		expect(selection.ids).toEqual(['n3', 'n4', 'n6']);
		await mounted.cleanup();
	});
});

describe('scope', () => {
	it('is the parent of the selection, and the page after clear', async () => {
		const mounted = await mount();
		const { selection } = mounted.ctx;
		expect(selection.scopeId).toBe('n1');
		selection.select(['n6']);
		expect(selection.scopeId).toBe('n5');
		selection.select(['n2']);
		expect(selection.scopeId).toBe('n1');
		selection.select(['n3']);
		expect(selection.scopeId).toBe('n2');
		selection.clear();
		expect(selection.scopeId).toBe('n1');
		await mounted.cleanup();
	});

	it('setScope accepts containers only', async () => {
		const mounted = await mount();
		const { selection } = mounted.ctx;
		selection.setScope('n5');
		expect(selection.scopeId).toBe('n5');
		expect(() => selection.setScope('n3')).toThrow(/not a container/);
		expect(() => selection.setScope('ghost')).toThrow(/not found/);
		await mounted.cleanup();
	});
});

describe('navigation', () => {
	it('selectParent, selectChildren and selectSibling', async () => {
		const mounted = await mount();
		const { selection } = mounted.ctx;
		selection.select(['n6']);
		selection.selectParent();
		expect(selection.ids).toEqual(['n5']);
		selection.selectParent();
		expect(selection.ids).toEqual(['n2']);
		selection.selectParent();
		expect(selection.ids).toEqual(['n2']);

		selection.selectChildren();
		expect(selection.ids).toEqual(['n3', 'n4', 'n5']);
		expect(selection.scopeId).toBe('n2');

		selection.select(['n3']);
		selection.selectChildren();
		expect(selection.ids).toEqual(['n3']);

		selection.selectSibling('next');
		expect(selection.ids).toEqual(['n4']);
		selection.selectSibling('previous');
		selection.selectSibling('previous');
		expect(selection.ids).toEqual(['n5']);
		await mounted.cleanup();
	});
});

describe('document changes', () => {
	it('survive unrelated changes without firing, and are pruned when nodes are deleted', async () => {
		const mounted = await mount();
		const { selection, document } = mounted.ctx;
		selection.select(['n3', 'n6']);
		const changes = recordChanges(mounted);

		document.apply(document.setProps('n4', { name: 'unrelated' }), user);
		expect(selection.ids).toEqual(['n3', 'n6']);
		expect(changes).toEqual([]);

		document.apply(document.removeNode('n5'), user);
		expect(selection.ids).toEqual(['n3']);
		expect(changes).toEqual([['n3']]);
		await mounted.cleanup();
	});

	it('are pruned when a node moves to another page', async () => {
		const mounted = await mount();
		const { selection, document } = mounted.ctx;
		selection.select(['n3']);
		document.apply(document.moveNode('n3', 'n7', 0), user);
		expect(selection.ids).toEqual([]);
		await mounted.cleanup();
	});

	it('an undone delete does not bring the selection back by itself', async () => {
		const mounted = await mount();
		const { selection, document } = mounted.ctx;
		selection.select(['n3']);
		const removal = document.apply(document.removeNode('n3'), user);
		document.apply(removal.undo, { ...user, replay: 'undo' });
		expect(document.has('n3')).toBe(true);
		expect(selection.ids).toEqual([]);
		await mounted.cleanup();
	});

	it('scope falls back to the page when its container is deleted', async () => {
		const mounted = await mount();
		const { selection, document } = mounted.ctx;
		selection.select(['n6']);
		expect(selection.scopeId).toBe('n5');
		document.apply(document.removeNode('n5'), user);
		expect(selection.scopeId).toBe('n1');
		await mounted.cleanup();
	});

	it('document replace clears selection and memory', async () => {
		const mounted = await mount();
		const { selection, document } = mounted.ctx;
		selection.select(['n3']);
		const other = sampleDocument();
		document.replaceDocument(other);
		expect(selection.ids).toEqual([]);
		await mounted.cleanup();
	});
});

describe('pages', () => {
	it('remembers the selection per page and restores it on switch', async () => {
		const mounted = await mount();
		const { selection, document } = mounted.ctx;
		const changes = recordChanges(mounted);
		selection.select(['n3', 'n4']);
		document.setCurrentPage('n7');
		expect(selection.ids).toEqual([]);
		expect(selection.scopeId).toBe('n7');
		selection.select(['n8']);
		document.setCurrentPage('n1');
		expect(selection.ids).toEqual(['n3', 'n4']);
		expect(selection.scopeId).toBe('n2');
		document.setCurrentPage('n7');
		expect(selection.ids).toEqual(['n8']);
		expect(changes).toEqual([['n3', 'n4'], [], ['n8'], ['n3', 'n4'], ['n8']]);
		await mounted.cleanup();
	});

	it('restoring drops nodes deleted while the page was away', async () => {
		const mounted = await mount();
		const { selection, document } = mounted.ctx;
		selection.select(['n3', 'n4']);
		document.setCurrentPage('n7');
		document.apply(document.setProps('n8', { name: 'x' }), user);
		document.setCurrentPage('n1');
		document.apply(document.removeNode('n4'), user);
		document.setCurrentPage('n7');
		document.setCurrentPage('n1');
		expect(selection.ids).toEqual(['n3']);
		await mounted.cleanup();
	});
});

describe('summary and context keys', () => {
	it('summarises kinds and the common parent', async () => {
		const mounted = await mount();
		const { selection, contextKeys } = mounted.ctx;
		expect(selection.summary()).toEqual({
			count: 0,
			kinds: [],
			kind: 'none',
			commonParentId: null
		});
		selection.select(['n3', 'n4']);
		expect(selection.summary()).toEqual({
			count: 2,
			kinds: ['RECTANGLE'],
			kind: 'RECTANGLE',
			commonParentId: 'n2'
		});
		selection.select(['n3', 'n5']);
		expect(selection.summary()).toMatchObject({ kind: 'mixed', commonParentId: 'n2' });
		selection.select(['n3', 'n6']);
		expect(selection.summary()).toMatchObject({ commonParentId: null });

		expect(contextKeys.get('hasSelection')).toBe(true);
		expect(contextKeys.get('selectionCount')).toBe(2);
		expect(contextKeys.get('selectionKind')).toBe('RECTANGLE');
		selection.clear();
		expect(contextKeys.get('hasSelection')).toBe(false);
		await mounted.cleanup();
	});

	it('is reactive', async () => {
		const mounted = await mount();
		const { selection } = mounted.ctx;
		const seen: number[] = [];
		const stop = $effect.root(() => {
			$effect(() => {
				seen.push(selection.count);
			});
		});
		await Promise.resolve();
		selection.select(['n3']);
		await Promise.resolve();
		stop();
		expect(seen).toEqual([0, 1]);
		await mounted.cleanup();
	});

	it('hover is cleared when its node is deleted', async () => {
		const mounted = await mount();
		const { selection, document } = mounted.ctx;
		selection.setHover('n3');
		expect(selection.hoverId).toBe('n3');
		document.apply(document.removeNode('n3'), user);
		expect(selection.hoverId).toBeNull();
		await mounted.cleanup();
	});
});
