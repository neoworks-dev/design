// Reactive holder behind the `pluginConsole` service (a Service may not hold runes).

export type ConsoleLevel = 'info' | 'warn' | 'error' | 'system';

export interface ConsoleLine {
	id: number;
	pluginId: string;
	level: ConsoleLevel;
	message: string;
	at: number;
}

export class PluginConsoleState {
	/** Newest last; capped by the service. */
	lines = $state.raw<ConsoleLine[]>([]);
	open = $state.raw(false);
	/** Show only this plugin's lines; `null` shows all. */
	filter = $state.raw<string | null>(null);
	createOpen = $state.raw(false);
	notice = $state.raw<{ text: string; error: boolean } | null>(null);
}
