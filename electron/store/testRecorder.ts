// Test helper: edits an in-memory document the way the renderer does (validated, normalized,
// atomic) and hands back the Transaction it would send to main. The in-memory store is the oracle
// the persisted file must equal.

import { applyChanges } from '../../src/lib/document/apply';
import { generateNodeId } from '../../src/lib/document/ids';
import { DocumentStore, invertChanges } from '../../src/lib/document/store';
import type { Change, DesignDocument, Transaction } from '../../src/lib/document/types';

export class TransactionRecorder {
	readonly store: DocumentStore;

	constructor(document: DesignDocument) {
		this.store = new DocumentStore(structuredClone(document));
	}

	/** Apply `changes` to the oracle and return the committed transaction. */
	edit(label: string, changes: Change[]): Transaction {
		const applied = applyChanges(this.store, changes);
		return {
			id: generateNodeId(),
			origin: 'user',
			label,
			changes: applied,
			undo: invertChanges(applied)
		};
	}

	get document(): DesignDocument {
		return this.store.document;
	}
}
