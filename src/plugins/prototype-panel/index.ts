import type { Context } from '@neoworks/extension-system';
import CursorClickIcon from 'phosphor-svelte/lib/CursorClickIcon';
import { contributeCommand } from '../../lib/editing/contribute';
import { PrototypeService } from '../../lib/services/prototype';
import { PrototypeState } from '../../lib/services/prototypeState.svelte';
import { CONNECTION_SELECTED_KEY, publishConnectionKey } from './contextKey.svelte';
import FlowsActions from './FlowsActions.svelte';
import FlowsSection from './FlowsSection.svelte';
import InteractionsActions from './InteractionsActions.svelte';
import InteractionsSection from './InteractionsSection.svelte';
import ScrollSection from './ScrollSection.svelte';
import SettingsSection from './SettingsSection.svelte';

const TAB_ID = 'prototype';

function selectedNode(ctx: Context): ReturnType<Context['document']['get']> {
	if (ctx.selection.ids.length !== 1) return undefined;
	return ctx.document.get(ctx.selection.ids[0]);
}

function hasReactions(ctx: Context): boolean {
	const node = selectedNode(ctx);
	return node !== undefined && 'reactions' in node;
}

function isFrame(ctx: Context): boolean {
	const node = selectedNode(ctx);
	return node !== undefined && node.type === 'FRAME';
}

// The Prototype tab (#121): flow starting points, the interactions of the selected node (trigger,
// action, destination, animation), overflow scrolling and the device preset. Interactions are the
// node's `reactions` and flows live on the page node, so every edit is a `document.apply` and
// undoes like any other. Provides the `prototyping` service the connection handles and the player
// share. Shift+E (core-panels) switches between Design and Prototype; Delete removes a selected
// connection.
export default {
	name: 'prototype-panel',
	inject: ['panels', 'document', 'selection', 'commands', 'keymap', 'contextKeys'],
	apply(ctx: Context): void {
		const state = new PrototypeState();
		new PrototypeService(ctx, ctx.document, state);

		ctx.effect(
			() =>
				ctx.panels.registerTab({
					id: TAB_ID,
					side: 'right',
					title: 'Prototype',
					icon: CursorClickIcon,
					order: 1,
					shortcut: 'Alt+9',
					when: "mode == 'design'"
				}),
			'prototype tab'
		);

		const sections = [
			{ id: 'flows', title: 'Flows', order: 0, component: FlowsSection, actions: FlowsActions },
			{
				id: 'interactions',
				title: 'Interactions',
				order: 1,
				component: InteractionsSection,
				actions: InteractionsActions,
				visible: () => hasReactions(ctx)
			},
			{
				id: 'scroll',
				title: 'Scroll behavior',
				order: 2,
				component: ScrollSection,
				visible: () => isFrame(ctx)
			},
			{ id: 'settings', title: 'Prototype settings', order: 3, component: SettingsSection }
		];
		for (const section of sections) {
			ctx.effect(
				() => ctx.panels.registerSection({ tab: TAB_ID, ...section }),
				`prototype section ${section.id}`
			);
		}

		ctx.effect(() => publishConnectionKey(state, ctx.contextKeys), 'prototype connection key');
		// The arrow belongs to the page it was drawn on.
		ctx.on('document/currentpagechange', () => ctx.prototyping.selectConnection(null));
		ctx.on('document/replace', () => ctx.prototyping.selectConnection(null));

		contributeCommand(ctx, {
			id: 'prototype.delete-connection',
			title: 'Delete selected connection',
			when: CONNECTION_SELECTED_KEY,
			run: () => ctx.prototyping.removeSelectedConnection()
		});
		for (const key of ['Delete', 'Backspace']) {
			ctx.effect(
				() =>
					ctx.keymap.register({
						key,
						command: 'prototype.delete-connection',
						scope: 'canvas',
						when: CONNECTION_SELECTED_KEY,
						priority: 10
					}),
				`key ${key} delete connection`
			);
		}
	}
};
