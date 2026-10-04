import type { Context } from '@neoworks/extension-system';
import { KeymapService } from '../../lib/registries/keymap.svelte';

interface KeymapConfig {
	/** `process.platform` value. Defaults to the desktop bridge, then to the browser. */
	platform?: string;
}

function detectPlatform(config: KeymapConfig | undefined): string {
	if (config && config.platform) return config.platform;
	const bridge = Reflect.get(globalThis, 'desktop');
	if (bridge && typeof bridge.system?.platform === 'string') return bridge.system.platform;
	if (typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)) return 'darwin';
	return 'linux';
}

export default {
	name: 'core-keymap',
	inject: ['commands', 'contextKeys'],
	apply(ctx: Context, config?: KeymapConfig): void {
		const keymap = new KeymapService(ctx, ctx.commands, ctx.contextKeys, {
			platform: detectPlatform(config)
		});

		ctx.effect(() => {
			const onKeydown = (event: KeyboardEvent): void => void keymap.handleKeydown(event);
			window.addEventListener('keydown', onKeydown);
			return () => window.removeEventListener('keydown', onKeydown);
		}, 'keymap/keydown');

		ctx.effect(() => {
			const onKeyup = (event: KeyboardEvent): void => keymap.handleKeyup(event);
			window.addEventListener('keyup', onKeyup);
			return () => window.removeEventListener('keyup', onKeyup);
		}, 'keymap/keyup');

		ctx.effect(() => {
			const onBlur = (): void => keymap.handleBlur();
			window.addEventListener('blur', onBlur);
			return () => window.removeEventListener('blur', onBlur);
		}, 'keymap/blur');
	}
};
