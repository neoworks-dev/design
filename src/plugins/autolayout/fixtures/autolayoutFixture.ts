// Test providers for the auto layout plugins: the editing provider set plus a text layout fake
// (every character is 10 wide, every line 20 tall) so no Skia is needed.

import type { Context, Plugin } from '@neoworks/extension-system';
import { plainText, type DesignDocument, type NodeId, type Paragraph } from '../../../lib/document';
import { rectangle, type NodeSpec } from '../../../lib/document/fixtures';
import { at, editingProviders } from '../../../lib/editing/fixtures/editingFixture';
import { fakeText } from '../../../lib/layout/testing';
import variablesCore from '../../variables-core';

export { at };

export function paragraphsOf(content: string): Paragraph[] {
	return [
		{
			runs: [{ text: content, style: {} }],
			align: 'LEFT',
			indent: 0,
			spacingAfter: 0,
			list: 'NONE',
			listLevel: 0
		}
	];
}

/** `ctx.textLayout` with the measurements `fakeText` makes up. */
export function fakeTextLayout(): Plugin {
	return {
		name: 'fake-text-layout',
		inject: ['document'],
		apply(ctx: Context): void {
			ctx.provide('textLayout', {
				measureAt(nodeId: NodeId, width: number | null) {
					const node = ctx.document.require(nodeId);
					if (node.type !== 'TEXT') throw new Error('not text');
					const size = fakeText(plainText(node.paragraphs))(width);
					return { ...size, lineCount: size.height / 20 };
				}
			});
		}
	} as Plugin;
}

export function autolayoutProviders(document: DesignDocument): Plugin[] {
	return [...editingProviders(document), variablesCore, fakeTextLayout()];
}

export function rect(id: string, width: number, height: number, x = 0, y = 0): NodeSpec {
	return rectangle({ id, name: id, width, height, transform: at(x, y) });
}
