import type { Context } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDocument, frame, page, rectangle } from '../../lib/document/fixtures';
import { editingProviders } from '../../lib/editing/fixtures/editingFixture';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import corePanels from '../core-panels';
import prototypePanel from './index';

function scene(): ReturnType<typeof buildDocument> {
	return buildDocument([
		page(
			'Page',
			[
				frame({ id: 'home', name: 'Home' }, [rectangle({ id: 'button', name: 'Button' })]),
				frame({ id: 'detail', name: 'Detail' }),
				frame({ id: 'other', name: 'Other' })
			],
			{ id: 'p' }
		)
	]);
}

const providers = (): ReturnType<typeof editingProviders> => [
	...editingProviders(scene()),
	corePanels
];

describePlugin('prototype-panel', prototypePanel, {
	providers: providers(),
	contributes: ({ ctx }) => {
		expect(ctx.panels.tabRegistry.get('prototype')).toBeDefined();
		expect(ctx.panels.sectionRegistry.get('prototype/interactions')).toBeDefined();
		expect(ctx.commands.has('prototype.delete-connection')).toBe(true);
	}
});

let mounted: MountedPlugin | undefined;

afterEach(async () => {
	await mounted?.cleanup();
	mounted = undefined;
});

async function mountPrototype(): Promise<Context> {
	mounted = await mountPlugin(prototypePanel, { providers: providers() });
	return mounted.ctx;
}

describe('interactions', () => {
	it('adds, edits and removes an interaction, each undoable', async () => {
		const ctx = await mountPrototype();
		ctx.prototyping.addInteraction('button');
		expect(ctx.prototyping.reactions('button')).toHaveLength(1);

		const [reaction] = ctx.prototyping.reactions('button');
		ctx.prototyping.updateInteraction('button', 0, {
			...reaction,
			trigger: { type: 'ON_HOVER' }
		});
		expect(ctx.prototyping.reactions('button')[0].trigger).toEqual({ type: 'ON_HOVER' });

		ctx.prototyping.removeInteraction('button', 0);
		expect(ctx.prototyping.reactions('button')).toHaveLength(0);

		ctx.history.undo();
		expect(ctx.prototyping.reactions('button')).toHaveLength(1);
		ctx.history.undo();
		expect(ctx.prototyping.reactions('button')[0].trigger).toEqual({ type: 'ON_CLICK' });
		ctx.history.undo();
		expect(ctx.prototyping.reactions('button')).toHaveLength(0);
	});

	it('connects a node to a frame and retargets instead of duplicating', async () => {
		const ctx = await mountPrototype();
		ctx.prototyping.connect('button', 'detail');
		expect(ctx.prototyping.connections()).toEqual([
			{ sourceId: 'button', reactionIndex: 0, destinationId: 'detail' }
		]);
		ctx.prototyping.connect('button', 'other');
		expect(ctx.prototyping.reactions('button')).toHaveLength(1);
		expect(ctx.prototyping.connections()[0].destinationId).toBe('other');
	});

	it('removes the selected connection', async () => {
		const ctx = await mountPrototype();
		ctx.prototyping.connect('button', 'detail');
		expect(ctx.prototyping.removeSelectedConnection()).toBe(true);
		expect(ctx.prototyping.connections()).toEqual([]);
	});
});

describe('flows and settings', () => {
	it('adds, renames and removes a flow starting point', async () => {
		const ctx = await mountPrototype();
		ctx.prototyping.addFlow('home');
		expect(ctx.prototyping.flows()).toEqual([{ nodeId: 'home', name: 'Flow 1' }]);
		ctx.prototyping.addFlow('home');
		expect(ctx.prototyping.flows()).toHaveLength(1);
		ctx.prototyping.renameFlow('home', 'Onboarding');
		expect(ctx.prototyping.flows()[0].name).toBe('Onboarding');
		ctx.prototyping.removeFlow('home');
		expect(ctx.prototyping.flows()).toEqual([]);
	});

	it('stores the device preset on the page', async () => {
		const ctx = await mountPrototype();
		expect(ctx.prototyping.settings().device).toBe('none');
		ctx.prototyping.setDevice('phone');
		expect(ctx.prototyping.settings().device).toBe('phone');
		ctx.history.undo();
		expect(ctx.prototyping.settings().device).toBe('none');
	});
});
