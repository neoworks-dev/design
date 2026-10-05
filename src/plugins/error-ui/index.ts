import type { Context } from '@neoworks/extension-system';
import { ErrorUiService } from '../../lib/services/errorUi';
import { ErrorUiState } from '../../lib/services/errorUiState.svelte';
import BootReportDialog from './BootReportDialog.svelte';
import ToastHost from './ToastHost.svelte';

// Failures made visible (#141): the boot report dialog (failed and pending plugins with retry and
// disable), toasts for errors after boot, the log viewer, copy diagnostics and safe mode. The
// per-contribution fallback is the error boundary of the region host. Crash and hang handling of
// the renderer lives in main (`main-diagnostics`).
export default {
	name: 'error-ui',
	inject: ['regions', 'desktop', 'commands', 'menus'],
	apply(ctx: Context): void {
		const errorUi = new ErrorUiService(ctx, ctx.desktop, new ErrorUiState(), localStorage);

		ctx.on('kernel/booted', (report) => errorUi.attachReport(report));

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'error-ui/dialog',
					region: 'overlay',
					component: BootReportDialog
				}),
			'boot report dialog'
		);
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'error-ui/toasts',
					region: 'overlay',
					component: ToastHost
				}),
			'toast host'
		);

		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'app.pluginStatus',
					title: 'Show plugin status...',
					run: () => errorUi.open('plugins')
				}),
			'command app.pluginStatus'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'app.showLogs',
					title: 'Show logs...',
					run: () => errorUi.open('logs')
				}),
			'command app.showLogs'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'app.copyDiagnostics',
					title: 'Copy diagnostics',
					run: () => errorUi.copyDiagnostics()
				}),
			'command app.copyDiagnostics'
		);
		ctx.effect(
			() =>
				ctx.commands.register({
					id: 'app.restartSafeMode',
					title: 'Restart in safe mode',
					run: () => errorUi.restart(true)
				}),
			'command app.restartSafeMode'
		);
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'app/help',
					item: { id: 'app.pluginStatus', command: 'app.pluginStatus', group: '9_status', order: 1 }
				}),
			'menu app/help plugin status'
		);
		ctx.effect(
			() =>
				ctx.menus.register({
					menu: 'app/help',
					item: { id: 'app.showLogs', command: 'app.showLogs', group: '9_status', order: 2 }
				}),
			'menu app/help logs'
		);

		// Errors nobody caught: tell the user instead of failing silently.
		ctx.effect(() => {
			const onError = (event: ErrorEvent): void => {
				errorUi.toast(`Something went wrong: ${event.message}`);
			};
			const onRejection = (event: PromiseRejectionEvent): void => {
				const reason: unknown = event.reason;
				const text = reason instanceof Error ? reason.message : String(reason);
				errorUi.toast(`Something went wrong: ${text}`);
			};
			window.addEventListener('error', onError);
			window.addEventListener('unhandledrejection', onRejection);
			return () => {
				window.removeEventListener('error', onError);
				window.removeEventListener('unhandledrejection', onRejection);
			};
		}, 'error-ui/uncaught errors');
	}
};
