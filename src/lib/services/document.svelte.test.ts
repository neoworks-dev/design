import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import documentPlugin from '../../plugins/document';
import { createNode, type Change, type DocumentChangeEvent, type Node } from '../document';
import { buildDocument, frame, page, rectangle } from '../document/fixtures';
import { describePlugin, mountPlugin } from '../kernel/testing';

// n1 page A: n2 frame F (n3 R1, n4 R2) ; n5 page B
const sample = (): ReturnType<typeof buildDocument> =>
	buildDocument([
		page('A', [frame({ name: 'F' }, [rectangle({ name: 'R1' }), rectangle({ name: 'R2' })])]),
		page('B')
	]);

describePlugin('document', documentPlugin, {
	contributes: ({ ctx }) => {
		expect(ctx.document.childNodes(null)).toHaveLength(1);
		expect(ctx.document.childNodes(null)[0].name).toBe('Page 1');
	}
});

async function mountWithDocument(
	extraPlugins: Plugin[] = []
): Promise<Awaited<ReturnType<typeof mountPlugin>>> {
	const mounted = await mountPlugin(documentPlugin, { config: { document: sample() } });
	for (const plugin of extraPlugins) await mounted.ctx.plugin(plugin);
	return mounted;
}

function recorder(events: DocumentChangeEvent[]): Plugin.Object {
	return {
		name: 'recorder',
		inject: ['document'],
		apply(ctx: Context): void {
			ctx.on('document/change', (event) => events.push(event));
		}
	};
}

const user = { origin: 'user' as const, label: 'Test' };

describe('document.apply', () => {
	it('applies, computes the exact undo, bumps the revision and emits document/change', async () => {
		const events: DocumentChangeEvent[] = [];
		const { ctx, cleanup } = await mountWithDocument([recorder(events)]);
		const { document } = ctx;
		const revision = document.revision;

		const transaction = document.apply(document.setProps('n3', { name: 'Renamed', opacity: 0.5 }), {
			origin: 'plugin',
			label: 'Rename and fade',
			mergeKey: 'k'
		});

		expect(document.get('n3')).toMatchObject({ name: 'Renamed', opacity: 0.5 });
		expect(document.revision).toBe(revision + 1);
		expect(transaction).toMatchObject({
			origin: 'plugin',
			label: 'Rename and fade',
			mergeKey: 'k'
		});
		expect(transaction.undo).toEqual([
			{
				t: 'set',
				id: 'n3',
				set: { name: 'R1', opacity: 1 },
				prev: { name: 'Renamed', opacity: 0.5 }
			}
		]);

		expect(events).toHaveLength(1);
		expect(events[0].transaction).toBe(transaction);
		expect(events[0].affectedNodeIds).toEqual(['n3']);
		expect(events[0].changes).toEqual([
			{ type: 'PROPERTY_CHANGE', id: 'n3', origin: 'plugin', properties: ['name', 'opacity'] }
		]);

		document.apply(transaction.undo, { origin: 'user', label: 'Undo', replay: 'undo' });
		expect(document.get('n3')).toMatchObject({ name: 'R1', opacity: 1 });
		await cleanup();
	});

	it('reports creates, deletes and moves with origin', async () => {
		const events: DocumentChangeEvent[] = [];
		const { ctx, cleanup } = await mountWithDocument([recorder(events)]);
		const { document } = ctx;
		const created = createNode('RECTANGLE', { id: 'x', parentId: 'n2', index: 'a5' });
		document.apply(
			[
				...document.insertNode(created),
				...document.moveNode('n4', 'n2', 0),
				...document.removeNode('n3')
			],
			user
		);
		expect(events[0].changes).toEqual([
			{ type: 'CREATE', id: 'x', origin: 'user' },
			{ type: 'PROPERTY_CHANGE', id: 'n4', origin: 'user', properties: ['parentId', 'index'] },
			{ type: 'DELETE', id: 'n3', origin: 'user' }
		]);
		await cleanup();
	});

	it('rejects an invalid change, throws, emits nothing and leaves the document untouched', async () => {
		const events: DocumentChangeEvent[] = [];
		const { ctx, cleanup } = await mountWithDocument([recorder(events)]);
		const { document } = ctx;
		const before = JSON.stringify(document.snapshot);
		const revision = document.revision;
		const changes: Change[] = [
			...document.setProps('n3', { name: 'fine' }),
			{ t: 'set', id: 'n4', set: { opacity: 'transparent' }, prev: {} }
		];
		expect(() => document.apply(changes, user)).toThrow(/invalid change/);
		expect(JSON.stringify(document.snapshot)).toBe(before);
		expect(document.revision).toBe(revision);
		expect(events).toEqual([]);
		await cleanup();
	});

	it('does not commit or emit an empty change list', async () => {
		const events: DocumentChangeEvent[] = [];
		const { ctx, cleanup } = await mountWithDocument([recorder(events)]);
		const revision = ctx.document.revision;
		const transaction = ctx.document.apply(ctx.document.setProps('n3', { name: 'R1' }), user);
		expect(transaction.changes).toEqual([]);
		expect(ctx.document.revision).toBe(revision);
		expect(events).toEqual([]);
		await cleanup();
	});

	it('rejects a component that would contain an instance of itself', async () => {
		const { ctx, cleanup } = await mountWithDocument();
		const { document } = ctx;
		const main = createNode('COMPONENT', { id: 'main', parentId: 'n1', index: 'a9' });
		document.apply(document.insertNode(main), user);
		const loop = createNode('INSTANCE', {
			id: 'loop',
			parentId: 'main',
			index: 'a0',
			mainComponentId: 'main'
		});
		expect(() => document.apply(document.insertNode(loop), user)).toThrow(/inside itself/);
		expect(document.has('loop')).toBe(false);
		await cleanup();
	});
});

describe('document/before-apply', () => {
	it('lets a listener veto by throwing', async () => {
		const veto: Plugin.Object = {
			name: 'veto',
			inject: ['document'],
			apply(ctx: Context): void {
				ctx.on('document/before-apply', (changes, meta, next) => {
					if (meta.origin === 'ai') throw new Error('AI may not edit');
					return next();
				});
			}
		};
		const { ctx, cleanup } = await mountWithDocument([veto]);
		const { document } = ctx;
		expect(() =>
			document.apply(document.setProps('n3', { name: 'x' }), { origin: 'ai', label: 'AI' })
		).toThrow('AI may not edit');
		expect(document.get('n3')).toMatchObject({ name: 'R1' });
		expect(() => document.apply(document.setProps('n3', { name: 'x' }), user)).not.toThrow();
		await cleanup();
	});

	it('lets a listener rewrite the changes', async () => {
		const rewrite: Plugin.Object = {
			name: 'rewrite',
			inject: ['document'],
			apply(ctx: Context): void {
				ctx.on('document/before-apply', (changes, meta, next) =>
					next().map((change) =>
						change.t === 'set' && 'name' in change.set
							? { ...change, set: { name: String(change.set.name).toUpperCase() } }
							: change
					)
				);
			}
		};
		const { ctx, cleanup } = await mountWithDocument([rewrite]);
		ctx.document.apply(ctx.document.setProps('n3', { name: 'loud' }), user);
		expect(ctx.document.get('n3')).toMatchObject({ name: 'LOUD' });
		await cleanup();
	});
});

describe('document/append', () => {
	// A fake reflow: whenever a frame's width changes, its children get the same width.
	const fakeReflow: Plugin.Object = {
		name: 'fake-reflow',
		inject: ['document'],
		apply(ctx: Context): void {
			ctx.on('document/append', ({ changes }, next) => {
				const derived: Change[] = [];
				for (const change of changes) {
					if (change.t !== 'set' || !('width' in change.set)) continue;
					for (const childId of ctx.document.children(change.id)) {
						derived.push({
							t: 'set',
							id: childId,
							set: { width: change.set.width },
							prev: {}
						});
					}
				}
				return [...next(), ...derived];
			});
		}
	};

	it('lands appended changes in the same transaction, tagged sync, with one exact undo', async () => {
		const events: DocumentChangeEvent[] = [];
		const { ctx, cleanup } = await mountWithDocument([recorder(events), fakeReflow]);
		const { document } = ctx;

		const transaction = document.apply(document.setProps('n2', { width: 250 }), user);

		expect(document.get('n3')).toMatchObject({ width: 250 });
		expect(document.get('n4')).toMatchObject({ width: 250 });
		expect(transaction.changes).toHaveLength(3);
		expect(events).toHaveLength(1);
		expect(events[0].changes).toEqual([
			{ type: 'PROPERTY_CHANGE', id: 'n2', origin: 'user', properties: ['width'] },
			{ type: 'PROPERTY_CHANGE', id: 'n3', origin: 'sync', properties: ['width'] },
			{ type: 'PROPERTY_CHANGE', id: 'n4', origin: 'sync', properties: ['width'] }
		]);

		document.apply(transaction.undo, { ...user, replay: 'undo' });
		expect(document.get('n2')).toMatchObject({ width: 100 });
		expect(document.get('n3')).toMatchObject({ width: 100 });
		expect(document.get('n4')).toMatchObject({ width: 100 });
		await cleanup();
	});

	it('rolls back the whole transaction when an appended change is invalid', async () => {
		const broken: Plugin.Object = {
			name: 'broken-sync',
			inject: ['document'],
			apply(ctx: Context): void {
				ctx.on('document/append', ({ changes }, next) => [
					...next(),
					...changes.map((_change): Change => ({
						t: 'set',
						id: 'n4',
						set: { opacity: 9 },
						prev: {}
					}))
				]);
			}
		};
		const { ctx, cleanup } = await mountWithDocument([broken]);
		expect(() => ctx.document.apply(ctx.document.setProps('n3', { name: 'x' }), user)).toThrow();
		expect(ctx.document.get('n3')).toMatchObject({ name: 'R1' });
		expect(ctx.document.get('n4')).toMatchObject({ opacity: 1 });
		await cleanup();
	});

	it('stops a derive loop that never settles', async () => {
		const loop: Plugin.Object = {
			name: 'loop',
			inject: ['document'],
			apply(ctx: Context): void {
				let flip = 0;
				ctx.on('document/append', (request, next) => {
					flip += 1;
					const derived: Change = {
						t: 'set',
						id: 'n3',
						set: { width: 100 + flip },
						prev: {}
					};
					return [...next(), derived];
				});
			}
		};
		const { ctx, cleanup } = await mountWithDocument([loop]);
		expect(() => ctx.document.apply(ctx.document.setProps('n3', { name: 'x' }), user)).toThrow(
			/did not settle/
		);
		expect(ctx.document.get('n3')).toMatchObject({ name: 'R1', width: 100 });
		await cleanup();
	});
});

describe('document.transaction', () => {
	it('commits several applies as one Transaction with one event', async () => {
		const events: DocumentChangeEvent[] = [];
		const { ctx, cleanup } = await mountWithDocument([recorder(events)]);
		const { document } = ctx;
		const revision = document.revision;
		document.transaction({ origin: 'plugin', label: 'Batch', runId: 'run1' }, () => {
			document.apply(document.setProps('n3', { name: 'one' }), { origin: 'plugin', label: 'a' });
			document.apply(document.setProps('n4', { name: 'two' }), { origin: 'plugin', label: 'b' });
			expect(document.get('n3')).toMatchObject({ name: 'one' });
			expect(events).toEqual([]);
		});
		expect(events).toHaveLength(1);
		expect(events[0].transaction.label).toBe('Batch');
		expect(events[0].transaction.changes).toHaveLength(2);
		expect(document.revision).toBe(revision + 1);

		document.apply(events[0].transaction.undo, { ...user, replay: 'undo' });
		expect(document.get('n3')).toMatchObject({ name: 'R1' });
		expect(document.get('n4')).toMatchObject({ name: 'R2' });
		await cleanup();
	});

	it('rolls everything back when the batch throws', async () => {
		const events: DocumentChangeEvent[] = [];
		const { ctx, cleanup } = await mountWithDocument([recorder(events)]);
		const { document } = ctx;
		const before = JSON.stringify(document.snapshot);
		expect(() =>
			document.transaction(user, () => {
				document.apply(document.setProps('n3', { name: 'one' }), user);
				document.apply([{ t: 'set', id: 'ghost', set: { name: 'x' }, prev: {} }], user);
			})
		).toThrow();
		expect(JSON.stringify(document.snapshot)).toBe(before);
		expect(events).toEqual([]);
		await cleanup();
	});

	it('rejects async runs instead of committing half a batch', async () => {
		const { ctx, cleanup } = await mountWithDocument();
		const before = JSON.stringify(ctx.document.snapshot);
		expect(() =>
			ctx.document.transaction(user, () => {
				ctx.document.apply(ctx.document.setProps('n3', { name: 'one' }), user);
				return Promise.resolve();
			})
		).toThrow(/synchronous/);
		expect(JSON.stringify(ctx.document.snapshot)).toBe(before);
		await cleanup();
	});

	it('a nested transaction joins the outer one', async () => {
		const events: DocumentChangeEvent[] = [];
		const { ctx, cleanup } = await mountWithDocument([recorder(events)]);
		const { document } = ctx;
		document.transaction(user, () => {
			document.transaction({ origin: 'user', label: 'inner' }, () => {
				document.apply(document.setProps('n3', { name: 'one' }), user);
			});
			document.apply(document.setProps('n4', { name: 'two' }), user);
		});
		expect(events).toHaveLength(1);
		await cleanup();
	});
});

describe('reads', () => {
	it('answers tree queries and is reactive', async () => {
		const { ctx, cleanup } = await mountWithDocument();
		const { document } = ctx;
		expect(document.children('n2')).toEqual(['n3', 'n4']);
		expect(document.descendants('n1').map((node: Node) => node.name)).toEqual(['F', 'R1', 'R2']);
		expect(document.query((node) => node.type === 'RECTANGLE').map((node) => node.id)).toEqual([
			'n3',
			'n4'
		]);

		const seen: string[] = [];
		const stop = $effect.root(() => {
			$effect(() => {
				const node = document.get('n3');
				if (node) seen.push(node.name);
			});
		});
		await Promise.resolve();
		document.apply(document.setProps('n3', { name: 'Renamed' }), user);
		await Promise.resolve();
		stop();
		expect(seen).toEqual(['R1', 'Renamed']);
		await cleanup();
	});

	it('replaceDocument swaps the document and announces it', async () => {
		const { ctx, cleanup } = await mountWithDocument();
		const replaced: string[] = [];
		await ctx.plugin({
			name: 'replace-listener',
			inject: ['document'],
			apply(inner: Context): void {
				inner.on('document/replace', (event) => replaced.push(event.documentId));
			}
		});
		const next = buildDocument([page('Only')]);
		next.id = 'other';
		ctx.document.replaceDocument(next);
		expect(replaced).toEqual(['other']);
		expect(ctx.document.childNodes(null).map((entry) => entry.name)).toEqual(['Only']);
		await cleanup();
	});
});
