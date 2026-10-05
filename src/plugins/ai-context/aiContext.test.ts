import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDocument, frame, node, page, rectangle, text } from '../../lib/document/fixtures';
import type { DesignDocument } from '../../lib/document';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { documentWith } from '../../lib/services/fixtures/documentFixture';
import coreCommands from '../core-commands';
import coreContextKeys from '../core-context-keys';
import desktopBridge from '../desktop-bridge';
import selectionPlugin from '../selection';
import variablesCore from '../variables-core';
import aiContext from './index';

function smallDocument(): DesignDocument {
	const document = buildDocument([
		page(
			'Home',
			[
				frame({ id: 'card', name: 'Card', width: 300, height: 200 }, [
					rectangle({ id: 'bg', name: 'Background', width: 300, height: 200 }),
					text({ id: 'title', name: 'Title' })
				]),
				node('COMPONENT', { id: 'button', name: 'Button', key: 'button-key' })
			],
			{ id: 'page1' }
		)
	]);
	document.styles.s1 = {
		id: 's1',
		type: 'PAINT',
		name: 'Accent',
		description: '',
		value: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }]
	};
	return document;
}

function hugeDocument(): DesignDocument {
	const rows = Array.from({ length: 400 }, (_, position) =>
		frame({ name: `Row ${position}`, width: 100, height: 20 }, [
			rectangle({ name: `Cell ${position}-a` }),
			rectangle({ name: `Cell ${position}-b` })
		])
	);
	return buildDocument([
		page('Big', [frame({ id: 'root', name: 'Everything' }, rows)], { id: 'page1' })
	]);
}

const exportCalls: { id: string; options: Record<string, unknown> }[] = [];

const fakeHeadlessRenderer: Plugin = {
	name: 'headless-renderer',
	apply(ctx: Context): void {
		ctx.provide('headlessRenderer', {
			exportNode: (id: string, options: Record<string, unknown>) => {
				exportCalls.push({ id, options });
				return Promise.resolve({
					bytes: new Uint8Array([137, 80, 78, 71]),
					width: 10,
					height: 10,
					format: 'PNG',
					mimeType: 'image/png'
				});
			}
		});
	}
};

function providers(document: DesignDocument): Plugin[] {
	return [
		coreContextKeys,
		coreCommands,
		desktopBridge,
		documentWith(document),
		selectionPlugin,
		variablesCore,
		fakeHeadlessRenderer
	];
}

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
	exportCalls.length = 0;
});

async function mountContext(document: DesignDocument, config?: unknown): Promise<Context> {
	mounted = await mountPlugin(aiContext, { providers: providers(document), desktop: true, config });
	return mounted.ctx;
}

describePlugin('ai-context', aiContext, {
	providers: providers(smallDocument()),
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.aiContext.build().selectedCount).toBe(0);
	}
});

describe('selection context', () => {
	it('summarises the page and the library when nothing is selected', async () => {
		const ctx = await mountContext(smallDocument());
		const result = ctx.aiContext.build();
		expect(result.text).toContain('Page "Home"');
		expect(result.text).toContain('FRAME "Card" (card)');
		expect(result.text).toContain('Components: Button');
		expect(result.text).toContain('Styles: Accent');
		expect(result.text).toContain('Nothing is selected');
		expect(ctx.aiContext.selectionAttachment()).toBeUndefined();
	});

	it('describes the selected subtree compactly and attaches it', async () => {
		const ctx = await mountContext(smallDocument());
		ctx.selection.select(['card']);
		const result = ctx.aiContext.build();
		expect(result.selectedCount).toBe(1);
		expect(result.truncated).toBe(false);
		expect(result.text).toContain('"name":"Background"');
		const attachment = ctx.aiContext.selectionAttachment();
		expect(attachment).toMatchObject({ kind: 'selection', label: 'Selection (1)' });
		expect(attachment?.text).toContain('The screenshot tool shows the selection');
	});

	it('stays under the character budget on a large selection', async () => {
		const ctx = await mountContext(hugeDocument(), { maxChars: 4000 });
		ctx.selection.select(['root']);
		const result = ctx.aiContext.build();
		expect(result.text.length).toBeLessThanOrEqual(4000);
		expect(result.truncated).toBe(true);
		expect(result.text).toContain('"name":"Everything"');
	});

	it('stays under the default budget with hundreds of selected layers', async () => {
		const ctx = await mountContext(hugeDocument());
		const rows = ctx.document.children('root');
		ctx.selection.select([...rows]);
		const result = ctx.aiContext.build();
		expect(result.selectedCount).toBe(400);
		expect(result.described).toBe(20);
		expect(result.text.length).toBeLessThanOrEqual(12_000);
		expect(result.text).toContain('380 more selected layers are not shown');
	});
});

describe('screenshot', () => {
	it('renders the selection scaled to fit, with overlapping layers drawn', async () => {
		const ctx = await mountContext(smallDocument());
		ctx.selection.select(['card']);
		const image = await ctx.aiContext.screenshot();
		expect(image).toMatchObject({ width: 10, height: 10, mimeType: 'image/png' });
		expect(image.bytes).toEqual(new Uint8Array([137, 80, 78, 71]));
		expect(exportCalls).toEqual([
			{ id: 'card', options: { scale: 1, contentsOnly: false, format: 'PNG' } }
		]);
	});

	it('falls back to the first top-level layer and fails on an empty page', async () => {
		const ctx = await mountContext(smallDocument());
		expect(ctx.aiContext.screenshotTarget()).toBe('card');
		expect(() => ctx.aiContext.screenshotTarget('missing')).toThrow('does not exist');
	});
});
