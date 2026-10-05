import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import type { FakeScript } from '../../lib/ai/fakeMain';
import { aiProviders, setupAi, taskScript, textNode } from '../../lib/ai/fixtures/aiFixture';
import { auditDocument, bindingCandidates, type BatchSource } from '../../lib/ai/batch';
import type { DesignDocument, ImagePaint } from '../../lib/document';
import { buildDocument, frame, page, rectangle } from '../../lib/document/fixtures';
import { at } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, type MountedPlugin } from '../../lib/kernel/testing';
import corePanels from '../core-panels';
import aiBatch from './index';

const image: ImagePaint = {
	type: 'IMAGE',
	visible: true,
	opacity: 1,
	blendMode: 'NORMAL',
	imageHash: 'h1',
	scaleMode: 'FILL'
};

function solid(r: number, g: number, b: number): unknown[] {
	return [{ type: 'SOLID', visible: true, opacity: 1, blendMode: 'NORMAL', color: { r, g, b } }];
}

function fixtureDocument(): DesignDocument {
	const document = buildDocument([
		page(
			'Page',
			[
				frame({ id: 'loose-row', name: 'Loose row', width: 300, height: 100 }, [
					rectangle({ id: 'one', name: 'One', transform: at(0, 0), width: 50, height: 50 }),
					rectangle({ id: 'two', name: 'Two', transform: at(80, 4), width: 50, height: 50 }),
					rectangle({ id: 'three', name: 'Three', transform: at(160, 0), width: 50, height: 50 })
				]),
				frame(
					{
						id: 'stack',
						name: 'Stack',
						layoutMode: 'VERTICAL',
						itemSpacing: 6,
						paddingTop: 10,
						paddingRight: 10,
						paddingBottom: 10,
						paddingLeft: 10
					},
					[rectangle({ id: 'cell', name: 'Cell' })]
				),
				rectangle({ id: 'photo', name: 'hero-photo', fills: [image] } as never),
				rectangle({ id: 'avatar', name: 'avatar', fills: [image] } as never),
				rectangle({ id: 'red-a', name: 'Red A', fills: solid(1, 0, 0) } as never),
				rectangle({ id: 'red-b', name: 'Red B', fills: solid(1, 0, 0) } as never),
				textNode('heading', 'Page title', 'Text'),
				textNode('body', 'Body', 'Real words already here'),
				textNode('empty', 'Caption', '')
			],
			{ id: 'p' }
		)
	]);
	document.variableCollections.c1 = {
		id: 'c1',
		name: 'Brand',
		modes: [{ modeId: 'm1', name: 'Light' }],
		defaultModeId: 'm1',
		variableIds: ['v1', 'v2']
	};
	document.variables.v1 = {
		id: 'v1',
		name: 'danger',
		collectionId: 'c1',
		resolvedType: 'COLOR',
		valuesByMode: { m1: { r: 1, g: 0, b: 0, a: 1 } },
		scopes: [],
		codeSyntax: {},
		description: ''
	};
	document.variables.v2 = {
		id: 'v2',
		name: 'space-m',
		collectionId: 'c1',
		resolvedType: 'FLOAT',
		valuesByMode: { m1: 10 },
		scopes: [],
		codeSyntax: {},
		description: ''
	};
	return document;
}

function providers(): Plugin[] {
	return aiProviders([corePanels], fixtureDocument());
}

let current: MountedPlugin | undefined;
afterEach(async () => {
	await current?.cleanup();
	current = undefined;
});

async function setup(script: FakeScript = taskScript()): Promise<Context> {
	const result = await setupAi(aiBatch, script, { providers: providers() });
	current = result.mounted;
	return result.ctx;
}

/** The first text the last run streamed. */
function lastReport(ctx: Context): string {
	const events = ctx.ai.runs().at(-1)?.events ?? [];
	for (const event of events) {
		if (event.type === 'text') return event.text;
	}
	return '';
}

function altTextOf(ctx: Context, id: string): string {
	const node = ctx.document.get(id);
	return node?.pluginData['ai-batch']?.altText ?? '';
}

describePlugin('ai-batch', aiBatch, {
	providers: providers(),
	desktop: true,
	contributes: ({ ctx }) => {
		for (const id of ['alt-text', 'content-fill', 'auto-layout', 'audit', 'bindings']) {
			expect(ctx.commands.has(`ai-batch.${id}`)).toBe(true);
		}
		for (const tool of ['set_alt_text', 'fill_content', 'convert_to_auto_layout']) {
			expect(ctx.ai.tools.has(tool)).toBe(true);
		}
	}
});

describe('generate alt text', () => {
	it('writes alt text on image layers only, in one undo step', async () => {
		const ctx = await setup();
		const steps = ctx.history.entries.length;
		const result = await ctx.aiBatch.run('alt-text');
		expect(result?.applied.sort()).toEqual(['avatar', 'photo']);
		expect(altTextOf(ctx, 'photo')).toBe('A picture of hero photo.');
		expect(altTextOf(ctx, 'red-a')).toBe('');
		expect(ctx.history.entries).toHaveLength(steps + 1);
		expect(ctx.history.entries.at(-1)).toMatchObject({ origin: 'ai', label: 'Generate alt text' });
		ctx.history.undo();
		expect(altTextOf(ctx, 'photo')).toBe('');
		expect(ctx.aiBatch.notice).toContain('2 layers');
	});

	it('works on the selection and skips layers that already have alt text', async () => {
		const ctx = await setup();
		ctx.selection.select(['photo']);
		await ctx.aiBatch.run('alt-text');
		expect(altTextOf(ctx, 'photo')).not.toBe('');
		expect(altTextOf(ctx, 'avatar')).toBe('');
		expect(ctx.aiBatch.targets('alt-text')).toEqual([]);
	});

	it('does not accept layers the task did not list', async () => {
		let answer = '';
		const ctx = await setup(async (turn) => {
			answer = (
				await turn.callTool('set_alt_text', {
					items: [
						{ id: 'photo', text: 'A mountain.' },
						{ id: 'red-a', text: 'Sneaky.' }
					]
				})
			).text;
		});
		await ctx.aiBatch.run('alt-text');
		expect(altTextOf(ctx, 'photo')).toBe('A mountain.');
		expect(altTextOf(ctx, 'red-a')).toBe('');
		expect(JSON.parse(answer).skipped).toEqual([
			{ id: 'red-a', reason: 'not one of the layers of this task' }
		]);
	});
});

describe('fill with placeholder content', () => {
	it('replaces empty and placeholder text, never real copy', async () => {
		const ctx = await setup();
		const result = await ctx.aiBatch.run('content-fill');
		expect(result?.applied.sort()).toEqual(['empty', 'heading']);
		const characters = (id: string): string => {
			const node = ctx.document.get(id);
			if (node === undefined || node.type !== 'TEXT') return '';
			return node.paragraphs
				.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
				.join('\n');
		};
		expect(characters('heading')).toBe('Plan your week');
		expect(characters('empty')).toBe('Fresh ingredients, delivered to your door.');
		expect(characters('body')).toBe('Real words already here');
	});
});

describe('convert to auto layout', () => {
	it('stacks a loose frame along its spread and leaves auto layout frames alone', async () => {
		const ctx = await setup();
		const result = await ctx.aiBatch.run('auto-layout');
		expect(result?.applied).toEqual(['loose-row']);
		expect(ctx.document.get('loose-row')).toMatchObject({ layoutMode: 'HORIZONTAL' });
		expect(ctx.document.get('stack')).toMatchObject({ layoutMode: 'VERTICAL', itemSpacing: 6 });
		ctx.history.undo();
		expect(ctx.document.get('loose-row')).toMatchObject({ layoutMode: 'NONE' });
	});

	it('skips an entry whose frame already has auto layout', async () => {
		let answer = '';
		const ctx = await setup(async (turn) => {
			answer = (
				await turn.callTool('convert_to_auto_layout', {
					items: [{ id: 'loose-row', direction: 'VERTICAL' }]
				})
			).text;
			await turn.callTool('convert_to_auto_layout', {
				items: [{ id: 'loose-row', direction: 'HORIZONTAL' }]
			});
		});
		await ctx.aiBatch.run('auto-layout');
		expect(JSON.parse(answer).applied).toEqual(['loose-row']);
		expect(ctx.document.get('loose-row')).toMatchObject({ layoutMode: 'VERTICAL' });
	});
});

describe('audit and binding suggestions', () => {
	it('audit is a read-only report with counted facts', async () => {
		const ctx = await setup();
		const revision = ctx.document.revision;
		await ctx.aiBatch.run('audit');
		expect(ctx.document.revision).toBe(revision);
		expect(ctx.ai.runs().at(-1)).toMatchObject({
			scope: 'read',
			label: 'Audit colors and spacing'
		});
		const text = lastReport(ctx);
		expect(text).toContain('Unbound solid colors: #ff0000 x2');
		expect(text).toContain('Spacing values: 6px x1, 10px x4');
		expect(text).toContain('Off the 4px grid: 6px, 10px');
		expect(ctx.aiBatch.notice).toContain('Report ready');
	});

	it('suggests bindings for values equal to a variable, and says when there are none', async () => {
		const ctx = await setup();
		await ctx.aiBatch.run('bindings');
		const body = lastReport(ctx);
		expect(body).toContain('Red A: bind fills[0].color (#ff0000) to danger');
		expect(body).toContain('Stack: bind paddingTop (10) to space-m');
		ctx.selection.select(['heading']);
		expect(await ctx.aiBatch.run('bindings')).toBeUndefined();
		expect(ctx.aiBatch.notice).toContain('No value equals a variable');
	});

	it('the read-only runs cannot write', async () => {
		let answer = { ok: true, text: '' };
		const ctx = await setup(async (turn) => {
			answer = await turn.callTool('set_alt_text', { items: [{ id: 'photo', text: 'x' }] });
		});
		await ctx.aiBatch.run('audit');
		expect(answer.ok).toBe(false);
		expect(altTextOf(ctx, 'photo')).toBe('');
	});
});

describe('pure facts', () => {
	it('counts colors and spacing and finds binding candidates over a source', () => {
		const document = fixtureDocument();
		const source: BatchSource = {
			get: (id) => document.nodes[id],
			children: (id) =>
				Object.values(document.nodes)
					.filter((node) => node.parentId === id)
					.map((node) => node.id),
			variableValues: () => [
				{ id: 'v1', name: 'danger', type: 'COLOR', value: '#ff0000' },
				{ id: 'v2', name: 'space-m', type: 'FLOAT', value: 10 }
			]
		};
		expect(auditDocument(source, source.children('p')).colors).toEqual([
			{ hex: '#ff0000', count: 2 }
		]);
		expect(bindingCandidates(source, ['red-a']).map((candidate) => candidate.variableName)).toEqual(
			['danger']
		);
	});
});
