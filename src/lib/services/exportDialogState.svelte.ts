// Reactive holder behind the `exportDialog` service (a Service may not hold runes).

import type { ExportFormatName } from '../export/types';

export type ExportScope = 'selection' | 'all' | 'slices';

export interface PreviewState {
	/** Index into the planned files this preview belongs to. */
	index: number;
	status: 'loading' | 'ready' | 'unavailable' | 'failed';
	/** An object URL of the rendered image while `ready`. */
	url: string | null;
	width: number;
	height: number;
	bytes: number;
	message: string;
}

export class ExportDialogState {
	isOpen = $state.raw(false);
	scope = $state.raw<ExportScope>('selection');
	/** Dialog-only file type; `null` exports each node with its own stored settings. */
	format = $state.raw<ExportFormatName | null>(null);
	/** Dialog-only size as typed (`2x`, `512w`); `null` uses the stored settings. */
	sizeText = $state.raw<string | null>(null);
	previewIndex = $state.raw(0);
	preview = $state.raw<PreviewState | null>(null);
	busy = $state.raw(false);
	/** What the last export or copy did, or why it failed. */
	status = $state.raw<{ kind: 'info' | 'error'; text: string } | null>(null);
}
