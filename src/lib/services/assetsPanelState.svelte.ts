// Reactive holder behind the `assetsPanel` service (a Service may not hold runes).

export class AssetsPanelState {
	query = $state.raw('');
	/** Section and group keys the user collapsed. */
	collapsed = $state.raw<readonly string[]>([]);
	/** The style being renamed in place. */
	renamingStyleId = $state.raw<string | null>(null);
	/** Why the last insert was refused (a component dropped into itself). */
	notice = $state.raw('');
}
