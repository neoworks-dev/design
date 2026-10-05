import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { readComments } from '../../lib/comments/model';
import { at, editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import {
	fakeCanvasInput,
	fakeOverlay,
	pointerEvent,
	selectionScene
} from '../../lib/selecting/fixtures/selectionFixture';
import corePanels from '../core-panels';
import coreInspectors from '../core-inspectors';
import designPanel from '../design-panel';
import coreTools from '../core-tools';
import hitTest from '../hit-test';
import spatial from '../spatial';
import comments from './index';

const panned: { x: number; y: number }[] = [];

const viewport: Plugin = {
	name: 'viewport',
	apply(ctx: Context): void {
		ctx.provide('viewport', {
			zoom: 1,
			camera: { x: 0, y: 0, scale: 1 },
			size: { width: 1000, height: 800 },
			visibleRect: () => ({ x: -5000, y: -5000, width: 10000, height: 10000 }),
			worldToScreen: (point: { x: number; y: number }) => point,
			screenToWorld: (point: { x: number; y: number }) => point,
			panBy: (x: number, y: number) => void panned.push({ x, y })
		});
	}
};

function providers(): Plugin[] {
	return [
		...editingProviders(selectionScene()),
		viewport,
		fakeOverlay,
		fakeCanvasInput,
		corePanels,
		coreTools,
		spatial,
		hitTest
	];
}

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
	panned.length = 0;
});

async function mountComments(): Promise<Context> {
	mounted = await mountPlugin(comments, { providers: providers() });
	return mounted.ctx;
}

function pageComments(ctx: Context): ReturnType<typeof readComments> {
	const page = ctx.document.require('p');
	return readComments('p', page.pluginData);
}

describePlugin('comments', comments, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.tools.get('comment')).toBeDefined();
		expect(ctx.panels.tabs('right').map((tab) => tab.id)).toContain('comments');
		expect(ctx.overlay.registry.list().map((entry) => entry.id)).toContain('comments/pins');
		expect(ctx.canvasInput.claimants.has('comments/pins')).toBe(true);
		expect(ctx.commands.has('comments.toggle-visibility')).toBe(true);
		const chords = ctx.keymap.registry.listAll().map((binding) => binding.chord);
		expect(chords).toContain('shift+c');
		expect(ctx.regions.contributions('canvas-overlay').map((entry) => entry.id)).toContain(
			'comments/editor'
		);
	}
});

describe('panel content', () => {
	it('renders with the comments plugin context', async () => {
		mounted = await mountPlugin(comments, {
			providers: [...providers(), coreInspectors, designPanel]
		});
		const { ctx } = mounted;
		const tab = ctx.panels.getTab('comments');
		expect(tab?.content?.ctx.fiber.name).toBe('comments');
	});
});

describe('creating', () => {
	it('a click with the comment tool starts a draft pinned to the node under it', async () => {
		const ctx = await mountComments();
		ctx.tools.activate('comment');
		ctx.tools.pointerDown(pointerEvent(20, 20));
		expect(ctx.comments.editor).toEqual({ kind: 'draft' });
		expect(ctx.comments.draft).toMatchObject({ pageId: 'p', point: { x: 20, y: 20 } });
		expect(ctx.comments.draft?.anchorId).not.toBeNull();
		// nothing is stored until the note is posted
		expect(pageComments(ctx)).toEqual([]);
	});

	it('posting stores the note in the page, as one undoable step', async () => {
		const ctx = await mountComments();
		ctx.comments.beginDraft({ x: 920, y: 20 });
		expect(ctx.comments.post('  Needs a darker fill  ')).toBe(true);
		const [comment] = pageComments(ctx);
		expect(comment).toMatchObject({ text: 'Needs a darker fill', resolved: false, anchorId: 'L' });
		expect(comment.offsetX).toBe(20);
		expect(ctx.comments.editor).toEqual({ kind: 'comment', id: comment.id });
		expect(ctx.comments.draft).toBeNull();

		ctx.history.undo();
		expect(pageComments(ctx)).toEqual([]);
		ctx.history.redo();
		expect(pageComments(ctx)).toHaveLength(1);
	});

	it('refuses an empty note and keeps the draft', async () => {
		const ctx = await mountComments();
		ctx.comments.beginDraft({ x: 920, y: 20 });
		expect(ctx.comments.post('   ')).toBe(false);
		expect(pageComments(ctx)).toEqual([]);
		expect(ctx.comments.draft).not.toBeNull();
		ctx.comments.cancelDraft();
		expect(ctx.comments.editor).toBeNull();
	});

	it('a click on empty canvas makes a free pin', async () => {
		const ctx = await mountComments();
		ctx.comments.beginDraft({ x: 3000, y: 3000 });
		ctx.comments.post('Nothing here yet');
		expect(pageComments(ctx)[0]).toMatchObject({ anchorId: null, x: 3000, y: 3000 });
	});
});

describe('editing, resolving, deleting', () => {
	async function withOne(): Promise<{ ctx: Context; id: string }> {
		const ctx = await mountComments();
		ctx.comments.beginDraft({ x: 920, y: 20 });
		ctx.comments.post('First');
		return { ctx, id: pageComments(ctx)[0].id };
	}

	it('edit, resolve and delete are each one undo step', async () => {
		const { ctx, id } = await withOne();
		expect(ctx.comments.setText(id, 'First, reworded')).toBe(true);
		expect(pageComments(ctx)[0].text).toBe('First, reworded');
		ctx.history.undo();
		expect(pageComments(ctx)[0].text).toBe('First');

		ctx.comments.setResolved(id, true);
		expect(pageComments(ctx)[0].resolved).toBe(true);
		ctx.history.undo();
		expect(pageComments(ctx)[0].resolved).toBe(false);

		ctx.comments.remove(id);
		expect(pageComments(ctx)).toEqual([]);
		expect(ctx.comments.editor).toBeNull();
		ctx.history.undo();
		expect(pageComments(ctx)).toHaveLength(1);
	});

	it('changing nothing does not add an undo step', async () => {
		const { ctx, id } = await withOne();
		const before = ctx.history.undoLabel;
		ctx.comments.setText(id, 'First');
		ctx.comments.setResolved(id, false);
		expect(ctx.history.undoLabel).toBe(before);
		expect(ctx.comments.setText(id, '  ')).toBe(false);
	});
});

describe('pins follow their node', () => {
	it('moving the node moves the pin; deleting it leaves the pin where it was', async () => {
		const ctx = await mountComments();
		ctx.comments.beginDraft({ x: 920, y: 20 });
		ctx.comments.post('Follow me');
		const [comment] = ctx.comments.all();
		expect(ctx.comments.positionOf(comment)).toEqual({ x: 920, y: 20 });

		ctx.document.apply(ctx.document.setProps('L', { transform: at(1500, 300) }), {
			origin: 'user',
			label: 'Move'
		});
		expect(ctx.comments.positionOf(ctx.comments.all()[0])).toEqual({ x: 1520, y: 320 });

		ctx.document.apply(ctx.document.removeNode('L'), { origin: 'user', label: 'Delete' });
		expect(ctx.comments.positionOf(ctx.comments.all()[0])).toEqual({ x: 920, y: 20 });
	});

	it('finds the pin of the current page under a canvas pixel', async () => {
		const ctx = await mountComments();
		ctx.comments.beginDraft({ x: 3000, y: 3000 });
		ctx.comments.post('Hit me');
		const [comment] = ctx.comments.all();
		// the bubble sits above the tip, so the middle of the bubble is the target
		const centre = ctx.comments.bubbleCentre(comment);
		expect(ctx.comments.pinAt(centre)?.id).toBe(comment.id);
		expect(ctx.comments.pinAt({ x: 3000, y: 3000 + 40 })).toBeUndefined();
	});

	it('a press on a pin opens its note with any tool', async () => {
		const ctx = await mountComments();
		ctx.comments.beginDraft({ x: 3000, y: 3000 });
		ctx.comments.post('Open me');
		const [comment] = ctx.comments.all();
		ctx.comments.closeEditor();

		const centre = ctx.comments.bubbleCentre(comment);
		const claimant = ctx.canvasInput.claimants.get('comments/pins');
		const grab = claimant?.claim(pointerEvent(centre.x, centre.y));
		expect(grab).toBeDefined();
		grab?.up(pointerEvent(centre.x, centre.y));
		expect(ctx.comments.editor).toEqual({ kind: 'comment', id: comment.id });
		expect(claimant?.claim(pointerEvent(10, 10))).toBeUndefined();
	});
});

describe('listing, search and showing', () => {
	it('searches and filters across the notes and jumps to a pin', async () => {
		const ctx = await mountComments();
		ctx.comments.beginDraft({ x: 3000, y: 3000 });
		ctx.comments.post('Alpha note');
		ctx.comments.beginDraft({ x: 3100, y: 3100 });
		ctx.comments.post('Beta note');
		const [alpha] = ctx.comments.all();
		ctx.comments.setResolved(alpha.id, true);

		expect(ctx.comments.listed().map((comment) => comment.text)).toEqual([
			'Alpha note',
			'Beta note'
		]);
		ctx.comments.setFilter('open');
		expect(ctx.comments.listed().map((comment) => comment.text)).toEqual(['Beta note']);
		ctx.comments.setFilter('all');
		ctx.comments.setQuery('alp');
		expect(ctx.comments.listed().map((comment) => comment.text)).toEqual(['Alpha note']);

		ctx.comments.closeEditor();
		ctx.comments.jumpTo(alpha.id);
		expect(ctx.comments.editor).toEqual({ kind: 'comment', id: alpha.id });
		// the pin is centred: the canvas is panned by the distance from its tip to the middle
		expect(panned.at(-1)).toEqual({ x: 500 - 3000, y: 400 - 3000 });
	});

	it('Shift+C hides and shows the pins; hiding closes the editor', async () => {
		const ctx = await mountComments();
		ctx.comments.beginDraft({ x: 3000, y: 3000 });
		ctx.comments.post('Visible');
		expect(ctx.comments.visible).toBe(true);
		await ctx.commands.run('comments.toggle-visibility');
		expect(ctx.comments.visible).toBe(false);
		expect(ctx.comments.editor).toBeNull();
		expect(ctx.canvasInput.claimants.get('comments/pins')?.claim(pointerEvent(3000, 2989))).toBe(
			undefined
		);
		await ctx.commands.run('comments.toggle-visibility');
		expect(ctx.comments.visible).toBe(true);
	});

	it('activating the tool shows hidden pins, and leaving it drops a draft', async () => {
		const ctx = await mountComments();
		ctx.comments.setVisible(false);
		ctx.tools.activate('comment');
		expect(ctx.comments.visible).toBe(true);
		ctx.tools.pointerDown(pointerEvent(3000, 3000));
		expect(ctx.comments.draft).not.toBeNull();
		ctx.tools.register({ id: 'move', title: 'Move' });
		ctx.tools.activate('move');
		expect(ctx.comments.draft).toBeNull();
	});

	it('a replaced document closes the editor', async () => {
		const ctx = await mountComments();
		ctx.comments.beginDraft({ x: 3000, y: 3000 });
		ctx.comments.post('Gone');
		ctx.emit('document/replace', { revision: 0, documentId: 'x' });
		expect(ctx.comments.editor).toBeNull();
	});
});
