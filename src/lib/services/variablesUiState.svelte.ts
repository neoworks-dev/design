// Reactive holder behind the `variablesUi` service (a Service may not hold runes).

export class VariablesUiState {
	isOpen = $state.raw(false);
	/** The collection whose variables the modal shows. */
	collectionId = $state.raw<string | null>(null);
	/** Why the last edit was refused (an alias cycle, a duplicate mode), shown in the modal. */
	error = $state.raw('');
	/** The variable whose scopes and code syntax are expanded. */
	expandedVariableId = $state.raw<string | null>(null);
}
