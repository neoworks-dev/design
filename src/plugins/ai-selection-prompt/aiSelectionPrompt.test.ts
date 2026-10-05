import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeAiMain, FakeScript } from '../../lib/ai/fakeMain';
import { aiProviders, rectanglesHtml, setupAi, writeHtml } from '../../lib/ai/fixtures/aiFixture';
import {
	BUTTON_GAP,
	BUTTON_SIZE,
	buttonPosition,
	cardPosition,
	CARD_WIDTH,
	inHotZone
} from '../../lib/ai/selectionPrompt';
import { describePlugin, type MountedPlugin } from '../../lib/kernel/testing';
import { fakeCanvasInput } from '../../lib/selecting/fixtures/selectionFixture';
import aiChat from '../ai-chat';
import aiContext from '../ai-context';
import corePanels from '../core-panels';
import coreTools from '../core-tools';
import aiSelectionPrompt from './index';

const fakeViewport: Plugin = {
	name: 'viewport',
	apply(ctx: Context): void {
		ctx.provide('viewport', {
			size: { width: 1000, height: 800 },
			worldToScreen: (point: { x: number; y: number }) => point
		});
	}
};

function providers(): Plugin[] {
	return aiProviders([fakeViewport, fakeCanvasInput, coreTools, corePanels, aiContext, aiChat]);
}

let current: MountedPlugin | undefined;
afterEach(async () => {
	await current?.cleanup();
	current = undefined;
});

async function setup(
	script: FakeScript
): Promise<{ ctx: Context; main: FakeAiMain; prompts: string[] }> {
	const prompts: string[] = [];
	const result = await setupAi(
		aiSelectionPrompt,
		async (turn) => {
			prompts.push(turn.prompt);
			await script(turn);
		},
		{ providers: providers() }
	);
	current = result.mounted;
	return { ctx: result.ctx, main: result.main, prompts };
}

function firstNodeIds(ctx: Context, count: number): string[] {
	const page = ctx.document.currentPageId;
	return ctx.document.children(page).slice(0, count);
}

describePlugin('ai-selection-prompt', aiSelectionPrompt, {
	providers: providers(),
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.regions.contributions('canvas-overlay').map((entry) => entry.id)).toContain(
			'ai-selection-prompt/button'
		);
		expect(ctx.commands.has('ai-selection-prompt.open')).toBe(true);
	}
});

describe('the AI button next to the selection', () => {
	it('is offered for one selected layer or several, with the pointer tool', async () => {
		const { ctx } = await setup(() => Promise.resolve());
		const prompt = ctx.aiSelectionPrompt;
		expect(prompt.available).toBe(false);
		const [first, second] = firstNodeIds(ctx, 2);
		ctx.selection.select([first]);
		expect(prompt.available).toBe(true);
		expect(prompt.anchorBounds()).toEqual(ctx.document.absoluteBounds(first));
		ctx.selection.select([first, second]);
		expect(prompt.available).toBe(true);
	});

	it('sends the request with the selection into the chat conversation and its session', async () => {
		const { ctx, main, prompts } = await setup(async (turn) => {
			turn.send({ type: 'text', text: 'Looking at it first.' });
			await writeHtml(turn, rectanglesHtml(2));
			turn.send({ type: 'text', text: 'Made two layouts.' });
		});
		const prompt = ctx.aiSelectionPrompt;
		const [first] = firstNodeIds(ctx, 1);
		ctx.selection.select([first]);
		ctx.aiChat.setDraft('Earlier');
		ctx.aiChat.send();
		await vi.waitFor(() => expect(ctx.aiChat.running).toBe(false));
		ctx.selection.select([first]);

		prompt.open();
		expect(prompt.isOpen).toBe(true);
		prompt.setDraft('Make two layouts of this');
		expect(prompt.send()).toBe(true);
		expect(prompt.runView()?.running).toBe(true);
		await vi.waitFor(() => expect(prompt.runView()?.running).toBe(false));
		expect(prompt.runView()?.answer).toBe('Made two layouts.');

		const conversation = ctx.aiChat.conversation();
		expect(conversation.map((record) => record.prompt)).toEqual([
			'Earlier',
			'Make two layouts of this'
		]);
		expect(prompts[1]).toContain('Make two layouts of this');
		expect(prompts[1]).toContain('[Selection (1)]');
		expect(main.started).toHaveLength(1);
	});

	it('closes an idle card when the selection changes, but not while its run works', async () => {
		let release: () => void = () => {};
		const turnDone = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { ctx } = await setup(() => turnDone);
		const prompt = ctx.aiSelectionPrompt;
		const [first, second] = firstNodeIds(ctx, 2);
		ctx.selection.select([first]);
		prompt.open();
		ctx.selection.select([second]);
		expect(prompt.isOpen).toBe(false);

		prompt.open();
		prompt.setDraft('Go');
		prompt.send();
		ctx.selection.select([first]);
		expect(prompt.isOpen).toBe(true);
		expect(prompt.anchorBounds()).toEqual(ctx.document.absoluteBounds(second));
		release();
		await vi.waitFor(() => expect(prompt.runView()?.running).toBe(false));
	});

	it('hands over to the chat when the document was not allowed yet', async () => {
		const { ctx } = await setup(() => Promise.resolve());
		ctx.ai.revokeConsent(ctx.document.documentId);
		const prompt = ctx.aiSelectionPrompt;
		ctx.selection.select(firstNodeIds(ctx, 1));
		prompt.open();
		prompt.setDraft('Tidy this up');
		expect(prompt.send()).toBe(false);
		expect(prompt.isOpen).toBe(false);
		expect(ctx.aiChat.awaitingConsent).toBe(true);
		expect(ctx.aiChat.draft).toBe('Tidy this up');
		expect(ctx.aiChat.attachSelection).toBe(true);
	});
});

describe('selection prompt placement', () => {
	const canvas = { width: 1000, height: 800 };
	const selection = { x: 100, y: 200, width: 300, height: 100 };

	it('puts the button above the top right corner and the card right of it', () => {
		const button = buttonPosition(selection, canvas);
		expect(button).toEqual({ x: 400 + BUTTON_GAP, y: 200 - BUTTON_GAP - BUTTON_SIZE });
		expect(cardPosition(button, canvas).x).toBe(button.x + BUTTON_SIZE + BUTTON_GAP);
	});

	it('keeps both on the canvas near its edges', () => {
		const button = buttonPosition({ x: 900, y: 0, width: 200, height: 50 }, canvas);
		expect(button.x).toBeLessThanOrEqual(canvas.width - BUTTON_SIZE);
		expect(button.y).toBeGreaterThanOrEqual(0);
		const card = cardPosition(button, canvas);
		expect(card.x + CARD_WIDTH).toBeLessThanOrEqual(canvas.width);
	});

	it('shows only when the pointer heads for the corner', () => {
		const button = buttonPosition(selection, canvas);
		expect(inHotZone({ x: 390, y: 205 }, selection, button)).toBe(true);
		expect(inHotZone({ x: button.x + 4, y: button.y + 4 }, selection, button)).toBe(true);
		expect(inHotZone({ x: 150, y: 250 }, selection, button)).toBe(false);
	});
});
