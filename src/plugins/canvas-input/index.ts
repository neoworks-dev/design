import type { Context } from '@neoworks/extension-system';
import { CursorOverride } from './cursor.svelte';
import { ModifierState } from './modifiers.svelte';
import { CanvasInputService } from './service';

// Provides `canvasInput`: the canvas input router (see service.ts). It follows the renderer's
// canvas through `renderer/canvas-change`, so it works whichever of the two loads first.
export default {
	name: 'canvas-input',
	inject: ['renderer', 'viewport', 'tools', 'keymap'],
	apply(ctx: Context): void {
		const input = new CanvasInputService(ctx, new ModifierState(), new CursorOverride());

		// Window level so a modifier pressed before the pointer enters the canvas is known.
		ctx.effect(() => {
			const update = (event: KeyboardEvent): void => input.modifiers.update(event);
			const reset = (): void => input.modifiers.reset();
			window.addEventListener('keydown', update, true);
			window.addEventListener('keyup', update, true);
			window.addEventListener('blur', reset);
			return () => {
				window.removeEventListener('keydown', update, true);
				window.removeEventListener('keyup', update, true);
				window.removeEventListener('blur', reset);
				input.modifiers.reset();
			};
		}, 'canvas-input/modifiers');

		let detach: (() => void) | undefined;
		const follow = (element: HTMLCanvasElement | undefined): void => {
			detach?.();
			detach = undefined;
			if (element) detach = input.attach(element);
		};
		ctx.on('renderer/canvas-change', follow);
		follow(ctx.renderer.canvasElement);
	}
};
