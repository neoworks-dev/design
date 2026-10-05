import type { Context } from '@neoworks/extension-system';
import { FileSessionService, type FileSessionOptions } from '../../lib/services/fileSession';
import { FileSessionState } from '../../lib/services/fileSessionState.svelte';
import { registerFileCommands } from './fileCommands';

// The link between the document and its file: autosave of every committed transaction, flushed
// when the window loses focus, hides or closes, when main asks (window close, quit) and when the
// plugin unmounts; new, open, save (a flush), rename and save a copy; the title and saving
// context keys the title bar reads; files renamed, moved or trashed elsewhere (`files:moved`);
// dropping a design file on the window opens it. Without a launch file it opens nothing: the
// home screen is the start page.
export default {
	name: 'file-session',
	inject: ['desktop', 'document', 'commands', 'keymap', 'contextKeys'],
	apply(ctx: Context, config?: FileSessionOptions): void {
		const session = new FileSessionService(
			ctx,
			ctx.desktop,
			ctx.document,
			ctx.contextKeys,
			new FileSessionState(),
			config
		);

		ctx.on('document/change', (event) => session.record(event));
		registerFileCommands(ctx, session);

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

		ctx.desktop.on('files:flush-request', ({ requestId }) => {
			session.answerFlushRequest(requestId).catch((error: unknown) => ctx.logger.error(error));
		});
		ctx.desktop.on('files:moved', (message) => session.handleMoved(message));
		ctx.desktop.on('files:open-request', ({ path }) => {
			session.openDocument(path).catch((error: unknown) => ctx.logger.error(error));
		});

		ctx.effect(() => {
			const hasFiles = (event: DragEvent): boolean =>
				event.dataTransfer !== null && event.dataTransfer.types.includes('Files');
			const onDragOver = (event: DragEvent): void => {
				if (hasFiles(event)) event.preventDefault();
			};
			const onDrop = (event: DragEvent): void => {
				if (!hasFiles(event) || event.dataTransfer === null) return;
				event.preventDefault();
				for (const file of event.dataTransfer.files) {
					if (!file.name.endsWith('.ndesign')) continue;
					session
						.openDocument(ctx.desktop.pathForFile(file))
						.catch((error: unknown) => ctx.logger.error(error));
					return;
				}
			};
			window.addEventListener('dragover', onDragOver);
			window.addEventListener('drop', onDrop);
			return () => {
				window.removeEventListener('dragover', onDragOver);
				window.removeEventListener('drop', onDrop);
			};
		}, 'file-session/drop-to-open');

		if (!config || config.startup !== 'none') {
			ctx.effect(() => {
				let cancelled = false;
				session.startup(() => cancelled).catch((error: unknown) => ctx.logger.error(error));
				return () => {
					cancelled = true;
				};
			}, 'file-session/startup');
		}

		ctx.effect(
			() => () => {
				session.clearKeys();
			},
			'file-session/context-keys'
		);
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
