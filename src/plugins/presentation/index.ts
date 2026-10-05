import type { Context } from '@neoworks/extension-system';
import { contributeCommand } from '../../lib/editing/contribute';
import { PresentationService } from '../../lib/services/presentation';
import { PresentationState } from '../../lib/services/presentationState.svelte';
import { PRESENTING_KEY, publishPresentingKey } from './contextKey.svelte';
import PresentationView from './PresentationView.svelte';

// While presenting, these keys win over everything bound to them in the editor.
const PRESENTING_PRIORITY = 100;

interface PlayerKey {
	key: string;
	command: string;
}

const PLAYER_KEYS: PlayerKey[] = [
	{ key: 'Escape', command: 'presentation.close' },
	{ key: 'ArrowRight', command: 'presentation.next' },
	{ key: 'ArrowLeft', command: 'presentation.previous' },
	{ key: 'R', command: 'presentation.restart' }
];

// Presentation (#124): Ctrl+Alt+Enter plays the prototype across the window and, where the
// platform allows, the screen; Shift+Space previews it inside the canvas area. Left and Right step
// between frames, R restarts, Esc closes. The bar above the player picks the device frame and how
// the frame is scaled; the device defaults to the page's prototype setting. Opening takes the frame
// holding the selection (or the first flow) as the start. Everything is a layer in the `overlay`
// region, so disposing the plugin closes the player and frees its pictures.
export default {
	name: 'presentation',
	inject: [
		'regions',
		'commands',
		'keymap',
		'menus',
		'contextKeys',
		'prototypePlayer',
		'prototyping',
		'selection',
		'document'
	],
	apply(ctx: Context): void {
		const state = new PresentationState();
		const presentation = new PresentationService(
			ctx,
			ctx.prototypePlayer,
			ctx.prototyping,
			ctx.selection,
			ctx.document,
			state
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'presentation/view',
					region: 'overlay',
					component: PresentationView
				}),
			'presentation view'
		);
		ctx.effect(() => publishPresentingKey(state, ctx.contextKeys), 'presentation context key');
		ctx.effect(() => () => presentation.close(), 'presentation close on unload');
		ctx.on('document/replace', () => presentation.close());
		ctx.on('document/currentpagechange', () => presentation.close());

		contributeCommand(ctx, {
			id: 'presentation.present',
			title: 'Present',
			keys: ['Mod+Alt+Enter'],
			run: () => presentation.open('present'),
			menus: [{ menu: 'app/view', group: '8_present', order: 1 }]
		});
		contributeCommand(ctx, {
			id: 'presentation.preview',
			title: 'Preview',
			keys: ['Shift+Space'],
			run: () => presentation.open('preview'),
			menus: [{ menu: 'app/view', group: '8_present', order: 2 }]
		});
		const playing = { when: PRESENTING_KEY };
		contributeCommand(ctx, {
			id: 'presentation.close',
			title: 'Close presentation',
			...playing,
			run: () => presentation.close()
		});
		contributeCommand(ctx, {
			id: 'presentation.next',
			title: 'Next frame',
			...playing,
			run: () => presentation.next()
		});
		contributeCommand(ctx, {
			id: 'presentation.previous',
			title: 'Previous frame',
			...playing,
			run: () => presentation.previous()
		});
		contributeCommand(ctx, {
			id: 'presentation.restart',
			title: 'Restart presentation',
			...playing,
			run: () => presentation.restart()
		});
		for (const { key, command } of PLAYER_KEYS) {
			ctx.effect(
				() =>
					ctx.keymap.register({
						key,
						command,
						scope: 'global',
						when: PRESENTING_KEY,
						priority: PRESENTING_PRIORITY
					}),
				`key ${key} ${command}`
			);
		}
	}
};
