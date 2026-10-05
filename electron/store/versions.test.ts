import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyChanges } from '../../src/lib/document/apply';
import { planSetProps } from '../../src/lib/document/changes';
import { buildDocument, frame, page, rectangle } from '../../src/lib/document/fixtures';
import { DocumentStore } from '../../src/lib/document/store';
import type { DesignDocument } from '../../src/lib/document/types';
import { DocumentFile } from './documentFile';
import { TransactionRecorder } from './testRecorder';
import { pruneTransactionLog } from './transactionWriter';
import { MAX_AUTOMATIC_MARKS } from './versions';

let directory = '';
beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'ndesign-versions-'));
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

function smallDocument(): DesignDocument {
	return buildDocument([
		page('A', [frame({ name: 'F' }, [rectangle({ name: 'R1' }), rectangle({ name: 'R2' })])])
	]);
}

function nameOf(document: DesignDocument, id: string): string {
	return document.nodes[id].name;
}

/** Creates a file, commits one rename per name, and returns the document after each one. */
function editedFile(names: string[]): {
	file: DocumentFile;
	states: DesignDocument[];
	recorder: TransactionRecorder;
} {
	const file = DocumentFile.create(path.join(directory, 'doc.ndesign'), smallDocument());
	const recorder = new TransactionRecorder(smallDocument());
	const states: DesignDocument[] = [structuredClone(recorder.document)];
	for (const name of names) {
		file.commit(recorder.edit(`Rename to ${name}`, planSetProps(recorder.store, 'n3', { name })));
		states.push(structuredClone(recorder.document));
	}
	return { file, states, recorder };
}

describe('version marks', () => {
	it('a named version marks the end of the log and lists oldest first', () => {
		const { file } = editedFile(['one', 'two']);
		const first = file.addVersion('Before the redesign');
		expect(first).toMatchObject({ name: 'Before the redesign', kind: 'named', seq: 2 });
		const recorder = new TransactionRecorder(smallDocument());
		file.commit(recorder.edit('x', planSetProps(recorder.store, 'n3', { name: 'three' })));
		const second = file.addVersion('Later');
		const history = file.versionHistory();
		expect(history.marks.map((mark) => mark.name)).toEqual(['Before the redesign', 'Later']);
		expect(history.latestSeq).toBe(3);
		expect(second.seq).toBe(3);
		expect(history.entries.map((entry) => entry.label)).toEqual([
			'Rename to one',
			'Rename to two',
			'x'
		]);
		file.close();
	});

	it('deleting a version removes only that mark', () => {
		const { file } = editedFile(['one']);
		const mark = file.addVersion('A');
		file.addVersion('B');
		file.deleteVersion(mark.id);
		expect(file.versionHistory().marks.map((entry) => entry.name)).toEqual(['B']);
		file.close();
	});

	it('Save adds an automatic mark only when something was logged since the last mark', () => {
		const { file } = editedFile(['one']);
		file.checkpoint();
		file.checkpoint();
		const saves = file.versionHistory().marks.filter((mark) => mark.kind === 'save');
		expect(saves).toHaveLength(1);
		expect(saves[0]).toMatchObject({ name: 'Saved', seq: 1 });
		file.close();
	});

	it('opening a file marks the session once there is something to mark', () => {
		const filePath = path.join(directory, 'doc.ndesign');
		const created = DocumentFile.create(filePath, smallDocument());
		const recorder = new TransactionRecorder(smallDocument());
		created.commit(recorder.edit('a', planSetProps(recorder.store, 'n3', { name: 'a' })));
		created.close();
		const reopened = DocumentFile.open(filePath);
		reopened.close();
		const again = DocumentFile.open(filePath);
		const sessions = again.versionHistory().marks.filter((mark) => mark.kind === 'session');
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({ name: 'Opened', seq: 1 });
		again.close();
	});

	it('keeps named versions forever and trims automatic ones', () => {
		const { file, recorder } = editedFile([]);
		file.addVersion('Keep me');
		for (let index = 0; index < MAX_AUTOMATIC_MARKS + 5; index += 1) {
			file.commit(
				recorder.edit('n', planSetProps(recorder.store, 'n3', { name: `name ${index}` }))
			);
			file.checkpoint();
		}
		const marks = file.versionHistory().marks;
		expect(marks.filter((mark) => mark.kind === 'save')).toHaveLength(MAX_AUTOMATIC_MARKS);
		expect(marks.filter((mark) => mark.kind === 'named')).toHaveLength(1);
		file.close();
	});
});

describe('restore plan', () => {
	it('undoing everything after a position gives exactly that position', () => {
		const { file, states } = editedFile(['one', 'two', 'three']);
		for (const seq of [0, 1, 2, 3]) {
			const plan = file.restorePlan(seq);
			expect(plan.available).toBe(true);
			expect(plan.count).toBe(3 - seq);
			const store = new DocumentStore(structuredClone(states[3]));
			applyChanges(store, plan.changes);
			expect(nameOf(store.document, 'n3')).toBe(nameOf(states[seq], 'n3'));
		}
		file.close();
	});

	it('restoring to the newest position changes nothing', () => {
		const { file } = editedFile(['one']);
		expect(file.restorePlan(1)).toMatchObject({ available: true, count: 0, changes: [] });
		file.close();
	});

	it('is not available once the range was pruned, and still is for the kept range', () => {
		const { file, states } = editedFile(['one', 'two', 'three', 'four']);
		const database = file.requireOpen();
		pruneTransactionLog(database, Date.now(), { maxRows: 2, maxAgeDays: 30 });

		const history = file.versionHistory();
		expect(history.latestSeq).toBe(4);
		expect(history.oldestSeq).toBe(3);
		expect(history.entries.map((entry) => entry.seq)).toEqual([3, 4]);

		expect(file.restorePlan(0).available).toBe(false);
		expect(file.restorePlan(1).available).toBe(false);
		const kept = file.restorePlan(2);
		expect(kept.available).toBe(true);
		const store = new DocumentStore(structuredClone(states[4]));
		applyChanges(store, kept.changes);
		expect(nameOf(store.document, 'n3')).toBe('two');
		file.close();
	});

	it('everything pruned: only the newest position is restorable', () => {
		const { file } = editedFile(['one', 'two']);
		const database = file.requireOpen();
		pruneTransactionLog(database, Date.now() + 365 * 24 * 60 * 60 * 1000);
		expect(file.versionHistory()).toMatchObject({ latestSeq: 2, oldestSeq: 3, entries: [] });
		expect(file.restorePlan(1).available).toBe(false);
		expect(file.restorePlan(2)).toMatchObject({ available: true, count: 0 });
		file.close();
	});

	it('refuses a position that was never logged', () => {
		const { file } = editedFile(['one']);
		expect(() => file.restorePlan(9)).toThrow(/not in the log/);
		file.close();
	});
});
