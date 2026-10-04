import fc from 'fast-check';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	planEntityAdd,
	planEntitySet,
	planInsert,
	planMoveNode,
	planRemove,
	planSetProps
} from '../../src/lib/document/changes';
import { createNode } from '../../src/lib/document/defaults';
import { buildDocument, frame, page, rectangle } from '../../src/lib/document/fixtures';
import type { Change, DesignDocument } from '../../src/lib/document/types';
import { TRANSACTION_LOG_MAX_AGE_DAYS, TRANSACTION_LOG_MAX_ROWS } from './constants';
import { DocumentFile } from './documentFile';
import { StoreError } from './errors';
import { richDocument } from './testDocument';
import { TransactionRecorder } from './testRecorder';

let directory = '';
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'ndesign-persist-'));
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

function filePath(name = 'doc'): string {
	return path.join(directory, `${name}.ndesign`);
}

// n1 page A: n2 frame F (n3 R1, n4 R2, n5 frame G (n6 R3)) ; n7 page B: n8 R4
function smallDocument(): DesignDocument {
	return buildDocument([
		page('A', [
			frame({ name: 'F' }, [
				rectangle({ name: 'R1' }),
				rectangle({ name: 'R2' }),
				frame({ name: 'G' }, [rectangle({ name: 'R3' })])
			])
		]),
		page('B', [rectangle({ name: 'R4' })])
	]);
}

function totalChanges(file: DocumentFile): number {
	const row = file.requireOpen().prepare('SELECT total_changes() AS total').get();
	return Number(row?.total);
}

describe('only affected rows are written', () => {
	it('a single property change writes one document row and one log row', () => {
		const file = DocumentFile.create(filePath(), smallDocument());
		const recorder = new TransactionRecorder(smallDocument());
		const transaction = recorder.edit('Rename', planSetProps(recorder.store, 'n3', { name: 'x' }));
		const stats = file.commit(transaction);
		expect(stats).toEqual({ documentRows: 1, logRows: 1, duplicate: false });
		file.close();
	});

	it('moves, inserts, deletes and entities write exactly the rows they touch', () => {
		const file = DocumentFile.create(filePath(), smallDocument());
		const recorder = new TransactionRecorder(smallDocument());
		const count = (label: string, changes: Change[]): number => {
			const stats = file.commit(recorder.edit(label, changes));
			expect(stats.logRows).toBe(1);
			return stats.documentRows;
		};

		expect(count('move', planMoveNode(recorder.store, 'n3', 'n5', 0))).toBe(1);
		const subtree = [
			createNode('FRAME', { id: 'p', parentId: 'n2', index: 'a9' }),
			createNode('RECTANGLE', { id: 'q', parentId: 'p', index: 'a0' }),
			createNode('RECTANGLE', { id: 'r', parentId: 'p', index: 'a1' })
		];
		expect(
			count(
				'insert',
				subtree.flatMap((node) => planInsert(node))
			)
		).toBe(3);
		expect(count('delete', planRemove(recorder.store, 'p'))).toBe(3);
		const variable = {
			id: 'v1',
			name: 'gap',
			collectionId: 'c1',
			resolvedType: 'FLOAT' as const,
			valuesByMode: { m: 1 },
			scopes: [],
			codeSyntax: {},
			description: ''
		};
		expect(count('variable', planEntityAdd('variable', variable))).toBe(1);
		expect(
			count('variable edit', planEntitySet(recorder.store, 'variable', 'v1', { name: 'g' }))
		).toBe(1);
		expect(file.load()).toEqual(recorder.document);
		file.close();
	});

	it('many changes to one node cost one row; a change that is reverted costs none', () => {
		const file = DocumentFile.create(filePath(), smallDocument());
		const recorder = new TransactionRecorder(smallDocument());
		const drag = recorder.edit('Drag', [
			...planSetProps(recorder.store, 'n3', { width: 101 }),
			{ t: 'set', id: 'n3', set: { width: 102 }, prev: {} },
			{ t: 'set', id: 'n3', set: { width: 103, height: 50 }, prev: {} }
		]);
		expect(file.commit(drag).documentRows).toBe(1);

		const there = recorder.edit('There', planSetProps(recorder.store, 'n4', { name: 'tmp' }));
		const back = recorder.edit('Back', planSetProps(recorder.store, 'n4', { name: 'R2' }));
		const roundTrip = {
			...there,
			id: 'there-and-back',
			changes: [...there.changes, ...back.changes],
			undo: [...back.undo, ...there.undo]
		};
		expect(file.commit(roundTrip).documentRows).toBe(0);
		expect(file.load()).toEqual(recorder.document);
		file.close();
	});

	it('does not rewrite the document: SQLite counts a handful of row changes on a 10k node file', () => {
		const specs = Array.from({ length: 10_000 }, (_, index) => rectangle({ name: `r${index}` }));
		const big = buildDocument([page('Big', [frame({}, specs)])]);
		const file = DocumentFile.create(filePath(), big);
		const recorder = new TransactionRecorder(big);
		const target = Object.keys(big.nodes)[5000];
		const transaction = recorder.edit(
			'One property',
			planSetProps(recorder.store, target, { name: 'changed' })
		);
		const before = totalChanges(file);
		file.commit(transaction);
		const delta = totalChanges(file) - before;
		// node row, log row, `modified_at`, first-time `unsaved` marker
		expect(delta).toBeLessThanOrEqual(4);
		file.close();
	});

	it('an asset record edit keeps its stored bytes', () => {
		const file = DocumentFile.create(filePath(), richDocument());
		const hash = 'a'.repeat(64);
		file.writeAssetBytes(hash, new Uint8Array([9, 9, 9]));
		const recorder = new TransactionRecorder(richDocument());
		file.commit(
			recorder.edit('Asset', planEntitySet(recorder.store, 'asset', hash, { width: 128 }))
		);
		expect([...(file.readAssetBytes(hash) ?? [])]).toEqual([9, 9, 9]);
		expect(file.load().assets[hash]).toMatchObject({ width: 128 });
		file.close();
	});
});

describe('the persisted file equals the in-memory document (property)', () => {
	type Edit =
		| { kind: 'insert'; target: number }
		| { kind: 'rename'; target: number; name: string }
		| { kind: 'resize'; target: number; width: number }
		| { kind: 'move'; target: number; destination: number; position: number }
		| { kind: 'remove'; target: number };
	const editArbitrary: fc.Arbitrary<Edit> = fc.oneof(
		fc.record({ kind: fc.constant('insert' as const), target: fc.nat(40) }),
		fc.record({ kind: fc.constant('rename' as const), target: fc.nat(40), name: fc.string() }),
		fc.record({ kind: fc.constant('resize' as const), target: fc.nat(40), width: fc.nat(500) }),
		fc.record({
			kind: fc.constant('move' as const),
			target: fc.nat(40),
			destination: fc.nat(40),
			position: fc.nat(5)
		}),
		fc.record({ kind: fc.constant('remove' as const), target: fc.nat(40) })
	);

	function changesFor(recorder: TransactionRecorder, edit: Edit, counter: number): Change[] {
		const ids = Object.keys(recorder.document.nodes);
		const target = ids[edit.target % ids.length];
		const node = recorder.store.requireNode(target);
		switch (edit.kind) {
			case 'insert':
				if (node.type === 'RECTANGLE') return [];
				return planInsert(
					createNode('RECTANGLE', { id: `new${counter}`, parentId: target, index: `a${counter}` })
				);
			case 'rename':
				return planSetProps(recorder.store, target, { name: edit.name });
			case 'resize':
				if (node.type === 'PAGE') return [];
				return planSetProps(recorder.store, target, { width: edit.width });
			case 'move':
				return planMoveNode(
					recorder.store,
					target,
					ids[edit.destination % ids.length],
					edit.position
				);
			case 'remove':
				return planRemove(recorder.store, target);
		}
	}

	it('after any sequence of committed transactions, load() equals the oracle', () => {
		let run = 0;
		fc.assert(
			fc.property(fc.array(editArbitrary, { maxLength: 25 }), (edits) => {
				run += 1;
				const file = DocumentFile.create(filePath(`prop-${run}`), smallDocument());
				const recorder = new TransactionRecorder(smallDocument());
				edits.forEach((edit, counter) => {
					let changes: Change[];
					try {
						changes = changesFor(recorder, edit, counter);
					} catch {
						return;
					}
					try {
						file.commit(recorder.edit('edit', changes));
					} catch (error) {
						if (error instanceof StoreError) throw error;
					}
				});
				expect(file.load()).toEqual(recorder.document);
				file.close();
			}),
			{ numRuns: 60 }
		);
	});
});

describe('crash recovery', () => {
	function snapshotWhileOpen(source: string, name: string): string {
		// What a kill -9 leaves: the main file plus the WAL, copied while the connection is open.
		const target = filePath(name);
		copyFileSync(source, target);
		for (const suffix of ['-wal', '-shm']) {
			if (existsSync(`${source}${suffix}`))
				copyFileSync(`${source}${suffix}`, `${target}${suffix}`);
		}
		return target;
	}

	function markerPresent(file: string): boolean {
		const database = new DatabaseSync(file);
		try {
			return database.prepare("SELECT 1 FROM meta WHERE key = 'session_open'").get() !== undefined;
		} finally {
			database.close();
		}
	}

	it('killing the app during editing and reopening yields the last committed transaction', () => {
		const original = filePath('live');
		const file = DocumentFile.create(original, smallDocument());
		const recorder = new TransactionRecorder(smallDocument());
		for (let step = 0; step < 50; step += 1) {
			file.commit(
				recorder.edit('nudge', planSetProps(recorder.store, 'n3', { width: 100 + step }))
			);
		}
		file.commit(recorder.edit('rename', planSetProps(recorder.store, 'n4', { name: 'last' })));

		const crashed = snapshotWhileOpen(original, 'crashed'); // file is never closed
		const reopened = DocumentFile.open(crashed);
		expect(reopened.info().recovered).toBe(true);
		expect(reopened.info().unsaved).toBe(true);
		expect(reopened.load()).toEqual(recorder.document);
		expect(reopened.transactionLog()).toHaveLength(51);
		reopened.close();
		file.close();
	});

	it('a clean close leaves no recovery marker and the next open is not recovered', () => {
		const target = filePath('clean');
		const file = DocumentFile.create(target, smallDocument());
		expect(markerPresent(snapshotWhileOpen(target, 'while-open'))).toBe(true);
		file.close();
		expect(markerPresent(target)).toBe(false);
		const reopened = DocumentFile.open(target);
		expect(reopened.info().recovered).toBe(false);
		reopened.close();
		expect(markerPresent(target)).toBe(false);
	});

	it('inspecting a file without a session never sets or clears the marker', () => {
		const target = filePath('inspect');
		const file = DocumentFile.create(target, smallDocument());
		const crashed = snapshotWhileOpen(target, 'inspect-crashed');
		file.close();

		const peek = DocumentFile.open(crashed, { session: false });
		expect(peek.info().recovered).toBe(true);
		peek.close();
		expect(markerPresent(crashed)).toBe(true);

		const again = DocumentFile.open(crashed);
		expect(again.info().recovered).toBe(true);
		again.close();
		expect(markerPresent(crashed)).toBe(false);
	});

	it('the unsaved flag follows commits and checkpoints and survives a crash', () => {
		const target = filePath('unsaved');
		const file = DocumentFile.create(target, smallDocument());
		const recorder = new TransactionRecorder(smallDocument());
		expect(file.info().unsaved).toBe(false);
		file.commit(recorder.edit('rename', planSetProps(recorder.store, 'n3', { name: 'a' })));
		expect(file.info().unsaved).toBe(true);
		file.checkpoint();
		expect(file.info().unsaved).toBe(false);
		expect(existsSync(`${target}-wal`) ? statSync(`${target}-wal`).size : 0).toBe(0);
		file.commit(recorder.edit('rename', planSetProps(recorder.store, 'n3', { name: 'b' })));
		const crashed = snapshotWhileOpen(target, 'unsaved-crashed');
		file.close();
		const reopened = DocumentFile.open(crashed);
		expect(reopened.info()).toMatchObject({ recovered: true, unsaved: true });
		reopened.close();
	});
});

describe('the transaction log', () => {
	it('records each transaction with its changes and undo', () => {
		const file = DocumentFile.create(filePath(), smallDocument());
		const recorder = new TransactionRecorder(smallDocument());
		const transaction = recorder.edit('Rename', planSetProps(recorder.store, 'n3', { name: 'x' }));
		file.commit(transaction, 5000);
		expect(file.transactionLog()).toEqual([
			{
				seq: 1,
				id: transaction.id,
				createdAt: 5000,
				origin: 'user',
				label: 'Rename',
				changes: transaction.changes,
				undo: transaction.undo
			}
		]);
		file.close();
	});

	it('is pruned to the last 1000 transactions', () => {
		const file = DocumentFile.create(filePath(), smallDocument());
		const recorder = new TransactionRecorder(smallDocument());
		const now = Date.now();
		for (let step = 0; step < TRANSACTION_LOG_MAX_ROWS + 150; step += 1) {
			file.commit(
				recorder.edit(`edit ${step}`, planSetProps(recorder.store, 'n3', { width: 1 + step })),
				now
			);
		}
		file.pruneLog(now);
		const log = file.transactionLog(5000);
		expect(log).toHaveLength(TRANSACTION_LOG_MAX_ROWS);
		expect(log[0].label).toBe('edit 150');
		expect(log[log.length - 1].label).toBe(`edit ${TRANSACTION_LOG_MAX_ROWS + 149}`);
		expect(file.load()).toEqual(recorder.document);
		file.close();
	});

	it('drops entries older than 30 days', () => {
		const file = DocumentFile.create(filePath(), smallDocument());
		const recorder = new TransactionRecorder(smallDocument());
		const day = 24 * 60 * 60 * 1000;
		const now = Date.now();
		file.commit(
			recorder.edit('old', planSetProps(recorder.store, 'n3', { name: 'a' })),
			now - (TRANSACTION_LOG_MAX_AGE_DAYS + 1) * day
		);
		file.commit(
			recorder.edit('recent', planSetProps(recorder.store, 'n3', { name: 'b' })),
			now - day
		);
		expect(file.pruneLog(now)).toBe(1);
		expect(file.transactionLog().map((entry) => entry.label)).toEqual(['recent']);
		file.close();
	});

	it('committing the same transaction twice is a no-op (a retry after a lost reply)', () => {
		const file = DocumentFile.create(filePath(), smallDocument());
		const recorder = new TransactionRecorder(smallDocument());
		const transaction = recorder.edit(
			'Insert',
			planInsert(createNode('RECTANGLE', { id: 'z', parentId: 'n2', index: 'a9' }))
		);
		expect(file.commit(transaction).duplicate).toBe(false);
		expect(file.commit(transaction)).toEqual({ documentRows: 0, logRows: 0, duplicate: true });
		expect(file.transactionLog()).toHaveLength(1);
		expect(file.load()).toEqual(recorder.document);
		file.close();
	});

	it('a transaction that does not fit the file is rejected whole and leaves no trace', () => {
		const file = DocumentFile.create(filePath(), smallDocument());
		const recorder = new TransactionRecorder(smallDocument());
		const good = recorder.edit('Rename', planSetProps(recorder.store, 'n3', { name: 'ok' }));
		const bad = {
			...good,
			id: 'bad',
			changes: [...good.changes, { t: 'set' as const, id: 'ghost', set: { name: 'x' }, prev: {} }]
		};
		expect(() => file.commit(bad)).toThrow(StoreError);
		expect(file.transactionLog()).toEqual([]);
		expect(file.load().nodes.n3).toMatchObject({ name: 'R1' });
		file.close();
	});
});

describe('write cost of a long session', () => {
	// Budget, asserted with ~10x headroom so CI noise does not flake: 1000 single-property
	// transactions on a 10k-node file: total under 3 s, slowest single commit under 50 ms.
	const TOTAL_BUDGET_MS = 3000;
	const SLOWEST_BUDGET_MS = 50;

	it('1000 transactions stay responsive', () => {
		const specs = Array.from({ length: 10_000 }, (_, index) => rectangle({ name: `r${index}` }));
		const big = buildDocument([page('Big', [frame({}, specs)])]);
		const file = DocumentFile.create(filePath('long'), big);
		const recorder = new TransactionRecorder(big);
		const ids = Object.keys(big.nodes);

		const durations: number[] = [];
		const started = performance.now();
		for (let step = 0; step < 1000; step += 1) {
			const id = ids[(step * 7) % ids.length];
			const node = recorder.store.requireNode(id);
			if (node.type === 'PAGE') continue;
			const transaction = recorder.edit(
				'nudge',
				planSetProps(recorder.store, id, { width: 10 + step })
			);
			const commitStarted = performance.now();
			file.commit(transaction);
			durations.push(performance.now() - commitStarted);
		}
		const total = performance.now() - started;
		const slowest = Math.max(...durations);
		const sorted = [...durations].sort((left, right) => left - right);
		const median = sorted[Math.floor(sorted.length / 2)];
		process.stdout.write(
			`persistence: 1000 commits on ${ids.length} nodes: total ${total.toFixed(0)} ms, median ${median.toFixed(2)} ms, slowest ${slowest.toFixed(2)} ms\n`
		);
		expect(total).toBeLessThan(TOTAL_BUDGET_MS);
		expect(slowest).toBeLessThan(SLOWEST_BUDGET_MS);
		expect(file.transactionLog(5000).length).toBeGreaterThan(900);
		file.close();
	});
});
