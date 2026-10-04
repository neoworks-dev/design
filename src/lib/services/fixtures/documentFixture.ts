// Test helpers shared by the service tests: the document plugin pre-loaded with a fixture
// document, and the small sample used across them.

import type { Plugin } from '@neoworks/extension-system';
import documentPlugin from '../../../plugins/document';
import type { DesignDocument } from '../../document';
import { buildDocument, frame, page, rectangle } from '../../document/fixtures';

// n1 page A: n2 frame F (n3 R1, n4 R2, n5 frame G (n6 R3)) ; n7 page B: n8 rect
export function sampleDocument(): DesignDocument {
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

/** The real document plugin under the same name, started with `document` loaded. */
export function documentWith(document: DesignDocument): Plugin.Object {
	return {
		name: 'document',
		inject: ['commands'],
		apply(ctx): void {
			documentPlugin.apply(ctx, { document });
		}
	};
}
