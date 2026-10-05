import type { Context } from '@neoworks/extension-system';
import { ArchiveService, type ArchiveOutcome } from '../../lib/services/archive';

// Zip-of-JSON export and import (#31) for diffing and sharing: `file.exportArchive` writes the
// open document as a deterministic zip of JSON files, `file.importArchive` reads one into a new
// design file and opens it. Provides `ctx.archive`. The outcome of a command is reported as a toast
// of the error UI.
export default {
	name: 'archive-io',
	inject: ['desktop', 'document', 'fileSession', 'commands', 'menus', 'errorUi'],
	apply(ctx: Context): void {
		const archive = new ArchiveService(ctx, ctx.desktop, ctx.document, ctx.fileSession);

		const report = (outcome: ArchiveOutcome): void => {
			ctx.logger.info(outcome.message);
			ctx.errorUi.toast(outcome.message, outcome.kind);
		};

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'file.exportArchive',
					title: 'Export as archive (zip of JSON)...',
					run: async () => report(await archive.exportArchive())
				}),
			'command file.exportArchive'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'file.importArchive',
					title: 'Import archive (zip of JSON)...',
					run: async () => report(await archive.importArchive())
				}),
			'command file.importArchive'
		);
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'app/file',
					item: {
						id: 'file.exportArchive',
						command: 'file.exportArchive',
						group: '8_export',
						order: 5
					}
				}),
			'menu app/file export archive'
		);
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'app/file',
					item: {
						id: 'file.importArchive',
						command: 'file.importArchive',
						group: '8_export',
						order: 6
					}
				}),
			'menu app/file import archive'
		);
	}
};
