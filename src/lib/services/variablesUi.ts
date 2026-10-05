// The `variablesUi` service: the state of the variables modal (#114). Edits go through the core
// `variables` service; this one adds what only the modal needs: which collection is shown, the
// error of a refused edit, and `attempt`, which runs an edit and turns a thrown refusal (alias
// cycle, type mismatch) into a message instead of an uncaught exception.

import { Service, type Context } from '@neoworks/extension-system';
import type { VariablesUiState } from './variablesUiState.svelte';

declare module '@neoworks/extension-system' {
	interface Context {
		variablesUi: VariablesUiService;
	}
}

export class VariablesUiService extends Service {
	constructor(
		ctx: Context,
		private readonly state: VariablesUiState
	) {
		super(ctx, 'variablesUi');
	}

	get isOpen(): boolean {
		return this.state.isOpen;
	}

	get error(): string {
		return this.state.error;
	}

	get expandedVariableId(): string | null {
		return this.state.expandedVariableId;
	}

	/** Reactive: the shown collection, falling back to the first one that exists. */
	get collectionId(): string | null {
		const shown = this.state.collectionId;
		if (shown !== null && this.ctx.variables.collection(shown) !== undefined) return shown;
		const [first] = this.ctx.variables.collections();
		if (first === undefined) return null;
		return first.id;
	}

	open(collectionId?: string): void {
		if (collectionId !== undefined) this.state.collectionId = collectionId;
		this.state.error = '';
		this.state.isOpen = true;
	}

	close(): void {
		this.state.isOpen = false;
		this.state.error = '';
		this.state.expandedVariableId = null;
	}

	select(collectionId: string): void {
		this.state.collectionId = collectionId;
		this.state.expandedVariableId = null;
		this.state.error = '';
	}

	toggleExpanded(variableId: string): void {
		if (this.state.expandedVariableId === variableId) this.state.expandedVariableId = null;
		else this.state.expandedVariableId = variableId;
	}

	dismissError(): void {
		this.state.error = '';
	}

	/** Runs `edit`; a refusal becomes the modal's error. Returns whether the edit applied. */
	attempt(edit: () => void): boolean {
		try {
			edit();
			this.state.error = '';
			return true;
		} catch (failure) {
			if (failure instanceof Error) this.state.error = this.withNames(failure.message);
			else this.state.error = String(failure);
			return false;
		}
	}

	/** Error messages mention variable ids; say the names the modal shows instead. */
	private withNames(message: string): string {
		let named = message;
		for (const variable of this.ctx.variables.variables()) {
			named = named.replaceAll(variable.id, variable.name);
		}
		return named;
	}

	snapshotState(): Record<string, unknown> {
		return { open: this.state.isOpen, collection: this.state.collectionId };
	}
}
