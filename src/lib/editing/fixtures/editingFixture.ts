// Fixtures for the editing tests: small documents with explicit positions, and the provider set
// the editing plugins need.

import type { Context, Plugin } from '@neoworks/extension-system';
import coreCommands from '../../../plugins/core-commands';
import coreContextKeys from '../../../plugins/core-context-keys';
import coreKeymap from '../../../plugins/core-keymap';
import coreMenus from '../../../plugins/core-menus';
import coreRegions from '../../../plugins/core-regions';
import historyPlugin from '../../../plugins/history';
import selectionPlugin from '../../../plugins/selection';
import {
	applyChanges,
	DocumentStore,
	type Change,
	type DesignDocument,
	type Matrix2x3,
	type NodeId
} from '../../document';
import { buildDocument, frame, page, rectangle, type NodeSpec } from '../../document/fixtures';
import { documentWith } from '../../services/fixtures/documentFixture';

export function at(x: number, y: number): Matrix2x3 {
	return [
		[1, 0, x],
		[0, 1, y]
	];
}

/** A rectangle with an explicit id, position and size. */
export function box(id: string, x: number, y: number, width = 10, height = 10): NodeSpec {
	return rectangle({ id, name: id, transform: at(x, y), width, height });
}

export function storeOf(pages: NodeSpec[]): DocumentStore {
	return new DocumentStore(buildDocument(pages));
}

export function applyTo(store: DocumentStore, changes: Change[]): void {
	applyChanges(store, changes);
}

export function orderOf(store: DocumentStore, parentId: NodeId): NodeId[] {
	return store.childNodes(parentId).map((node) => node.id);
}

/** Page `p` holding frame `f` (at 100,100) with boxes a, b, c, plus a top level box `loose`. */
export function sampleDocument(): DesignDocument {
	return buildDocument([
		page(
			'Page',
			[
				frame({ id: 'f', name: 'F', transform: at(100, 100), width: 400, height: 400 }, [
					box('a', 0, 0),
					box('b', 20, 20),
					box('c', 40, 40)
				]),
				box('loose', 600, 600)
			],
			{ id: 'p' }
		)
	]);
}

export function editingProviders(document: DesignDocument = sampleDocument()): Plugin[] {
	return [
		coreRegions,
		coreContextKeys,
		coreCommands,
		{ ...coreKeymap, apply: (ctx: Context) => coreKeymap.apply(ctx, { platform: 'linux' }) },
		coreMenus,
		documentWith(document),
		selectionPlugin,
		historyPlugin
	];
}
