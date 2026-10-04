import type { Context } from '@neoworks/extension-system';
import { FileSessionService, type FileSessionOptions } from '../../lib/services/fileSession';
import { FileSessionState } from '../../lib/services/fileSessionState.svelte';

// The link between the document and its file: autosave of every committed transaction, flushed
// when the window loses focus, hides or closes, and when the plugin unmounts.
export default {
	name: 'file-session',
	inject: ['desktop', 'document'],
	apply(ctx: Context, config?: FileSessionOptions): void {
		const session = new FileSessionService(ctx, ctx.desktop, new FileSessionState(), config);

		ctx.on('document/change', (event) => session.record(event));

		const flushQuietly = (): void => {
			session.flush().catch(() => undefined);
		};
		ctx.effect(() => {
			window.addEventListener('blur', flushQuietly);
			return () => window.removeEventListener('blur', flushQuietly);
		}, 'file-session/flush-on-blur');
		ctx.effect(() => {
			window.addEventListener('beforeunload', flushQuietly);
			return () => window.removeEventListener('beforeunload', flushQuietly);
		}, 'file-session/flush-on-unload');
		ctx.effect(() => {
			document.addEventListener('visibilitychange', flushQuietly);
			return () => document.removeEventListener('visibilitychange', flushQuietly);
		}, 'file-session/flush-on-hide');

		// Last thing on unmount: try to save what is queued, then stop the timers.
		ctx.effect(
			() => async () => {
				await session.flush().catch(() => undefined);
				session.stop();
			},
			'file-session/autosave'
		);
	}
};
