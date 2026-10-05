// Reactive holder behind the `errorUi` service (a Service may not hold runes).

import type { DiagnosticsReport } from '../../../electron/bridge';
import type { BootReport } from '../kernel/boot.svelte';

export type ErrorUiTab = 'plugins' | 'logs';
export type LogSource = 'main' | 'renderer';

export interface Toast {
	id: number;
	kind: 'error' | 'info';
	message: string;
}

export class ErrorUiState {
	report = $state.raw<BootReport | null>(null);
	isOpen = $state.raw(false);
	tab = $state.raw<ErrorUiTab>('plugins');
	logSource = $state.raw<LogSource>('renderer');
	/** The last `diagnostics:read` answer; `null` until the logs tab asked. */
	diagnostics = $state.raw<DiagnosticsReport | null>(null);
	toasts = $state.raw<Toast[]>([]);
	/** What the last action did ("Copied", or why it failed). */
	status = $state.raw('');
	/** Plugins the user switched off; they stay off at the next start. */
	disabledNames = $state.raw<string[]>([]);
}
