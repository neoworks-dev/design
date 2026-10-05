<script lang="ts">
	import { Button, Checkbox } from '@neoworks-dev/ui';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import GearIcon from 'phosphor-svelte/lib/GearIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import type { CodeSyntaxPlatform, Variable, VariableType } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import {
		groupPathOf,
		groupVariables,
		leafNameOf,
		scopeLabel,
		SCOPES_BY_TYPE,
		uniqueName
	} from '../../lib/variables/organize';
	import ValueCell from './ValueCell.svelte';

	const ctx = getKernel();
	const ui = ctx.variablesUi;

	const PLATFORMS: CodeSyntaxPlatform[] = ['WEB', 'ANDROID', 'iOS'];
	const NEW_VARIABLE: Array<{ type: VariableType; label: string }> = [
		{ type: 'COLOR', label: 'Color' },
		{ type: 'FLOAT', label: 'Number' },
		{ type: 'STRING', label: 'String' },
		{ type: 'BOOLEAN', label: 'Boolean' }
	];

	const collections = $derived(ctx.variables.collections());
	const collection = $derived.by(() => {
		const id = ui.collectionId;
		if (id === null) return undefined;
		return ctx.variables.collection(id);
	});
	const variables = $derived.by(() => {
		if (collection === undefined) return [];
		return ctx.variables.variables(collection.id);
	});
	const groups = $derived(groupVariables(variables));
	const columns = $derived.by(() => {
		if (collection === undefined) return '';
		return `grid-template-columns: 220px repeat(${collection.modes.length}, minmax(150px, 1fr)) 84px`;
	});

	function onkeydown(event: KeyboardEvent): void {
		if (!ui.isOpen || event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		ui.close();
	}

	function addCollection(): void {
		const name = uniqueName(
			'Collection',
			collections.map((entry) => entry.name)
		);
		ui.attempt(() => ui.select(ctx.variables.createCollection(name)));
	}

	function removeCollection(id: string): void {
		ui.attempt(() => ctx.variables.removeCollection(id));
	}

	function addVariable(type: VariableType, label: string): void {
		if (collection === undefined) return;
		const target = collection;
		const name = uniqueName(
			label,
			variables.map((entry) => entry.name)
		);
		ui.attempt(() => ctx.variables.createVariable(target.id, name, type));
	}

	function renameVariable(variable: Variable, leaf: string): void {
		const trimmed = leaf.trim();
		if (trimmed === '') return;
		const path = groupPathOf(variable.name);
		let name = trimmed;
		if (path !== '') name = `${path}/${trimmed}`;
		ui.attempt(() => ctx.variables.renameVariable(variable.id, name));
	}

	function toggleScope(variable: Variable, scope: string, on: boolean): void {
		const scopes = variable.scopes.filter((entry) => entry !== scope);
		if (on) scopes.push(scope);
		ui.attempt(() => ctx.variables.setVariableScopes(variable.id, scopes));
	}

	function syntaxOf(variable: Variable, platform: CodeSyntaxPlatform): string {
		const syntax = variable.codeSyntax[platform];
		if (syntax === undefined) return '';
		return syntax;
	}

	function setSyntax(variable: Variable, platform: CodeSyntaxPlatform, syntax: string): void {
		ui.attempt(() => ctx.variables.setCodeSyntax(variable.id, platform, syntax));
	}

	function addMode(): void {
		if (collection === undefined) return;
		const target = collection;
		const name = uniqueName(
			'Mode',
			target.modes.map((mode) => mode.name)
		);
		ui.attempt(() => ctx.variables.addMode(target.id, name));
	}
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if ui.isOpen}
	<div
		class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="presentation"
		onpointerdown={(event) => {
			if (event.target === event.currentTarget) ui.close();
		}}
	>
		<div
			role="dialog"
			aria-label="Variables"
			data-variables-dialog
			class="bg-elevated border-line text-default flex h-[620px] max-h-[92vh] w-[1020px] max-w-[95vw] flex-col rounded-lg border text-xs shadow-lg"
		>
			<div class="border-line-faint flex shrink-0 items-center gap-3 border-b px-4 py-3">
				<h2 class="text-sm font-semibold">Local variables</h2>
				<div class="flex-1"></div>
				<Button size="sm" variant="ghost" onclick={() => ui.close()}>Close</Button>
			</div>

			<div class="flex min-h-0 flex-1">
				<nav
					class="border-line-faint flex w-52 shrink-0 flex-col gap-1 border-r p-2"
					aria-label="Collections"
				>
					{#each collections as entry (entry.id)}
						<button
							type="button"
							class={[
								'hover:bg-hover flex items-center justify-between rounded px-2 py-1.5 text-left',
								entry.id === ui.collectionId && 'bg-raised'
							]}
							data-collection={entry.id}
							onclick={() => ui.select(entry.id)}
						>
							<span class="truncate">{entry.name}</span>
							<span class="text-faint tabular-nums">{entry.variableIds.length}</span>
						</button>
					{/each}
					<button
						type="button"
						class="text-muted hover:text-default hover:bg-hover flex items-center gap-1 rounded px-2 py-1.5 text-left"
						data-add-collection
						onclick={addCollection}
					>
						<PlusIcon size={12} /> New collection
					</button>
				</nav>

				<section class="flex min-w-0 flex-1 flex-col">
					{#if collection === undefined}
						<p class="text-faint p-6">Create a collection to start adding variables.</p>
					{:else}
						<div class="border-line-faint flex shrink-0 items-center gap-2 border-b px-3 py-2">
							<input
								class="bg-input border-line text-default h-7 w-56 rounded border px-2"
								aria-label="Collection name"
								value={collection.name}
								onchange={(event) =>
									ui.attempt(() =>
										ctx.variables.renameCollection(collection.id, event.currentTarget.value)
									)}
							/>
							<div class="flex-1"></div>
							<Button size="sm" variant="ghost" onclick={() => removeCollection(collection.id)}>
								Delete collection
							</Button>
						</div>

						<div class="min-h-0 flex-1 overflow-auto" data-variables-table>
							<div
								class="border-line-faint text-muted sticky top-0 z-10 grid items-center gap-2 border-b px-3 py-2"
								style={columns}
							>
								<span>Name</span>
								{#each collection.modes as mode (mode.modeId)}
									<div class="flex items-center gap-1" data-mode-header={mode.modeId}>
										<input
											class="bg-input border-line text-default h-7 min-w-0 flex-1 rounded border px-2"
											aria-label={`Mode name ${mode.name}`}
											value={mode.name}
											onchange={(event) =>
												ui.attempt(() =>
													ctx.variables.renameMode(
														collection.id,
														mode.modeId,
														event.currentTarget.value
													)
												)}
										/>
										{#if collection.modes.length > 1}
											<button
												type="button"
												class="text-muted hover:text-default"
												aria-label={`Remove mode ${mode.name}`}
												onclick={() =>
													ui.attempt(() => ctx.variables.removeMode(collection.id, mode.modeId))}
											>
												<XIcon size={12} />
											</button>
										{/if}
									</div>
								{/each}
								<button
									type="button"
									class="text-muted hover:text-default flex items-center gap-1"
									data-add-mode
									onclick={addMode}
								>
									<PlusIcon size={12} /> Mode
								</button>
							</div>

							{#each groups as group (group.path)}
								{#if group.path !== ''}
									<div class="text-faint px-3 pt-3 pb-1" data-variable-group={group.path}>
										{group.path}
									</div>
								{/if}
								{#each group.variables as variable (variable.id)}
									<div
										class="border-line-faint grid items-center gap-2 border-b px-3 py-1.5"
										style={columns}
										data-variable-row={variable.id}
									>
										<input
											class="bg-input border-line text-default h-7 min-w-0 rounded border px-2"
											aria-label={`Variable name ${variable.name}`}
											value={leafNameOf(variable.name)}
											onchange={(event) => renameVariable(variable, event.currentTarget.value)}
										/>
										{#each collection.modes as mode (mode.modeId)}
											<ValueCell {variable} modeId={mode.modeId} />
										{/each}
										<div class="flex items-center justify-end gap-1">
											<button
												type="button"
												class="text-muted hover:text-default"
												aria-label={`Scopes and code syntax of ${variable.name}`}
												aria-pressed={ui.expandedVariableId === variable.id}
												onclick={() => ui.toggleExpanded(variable.id)}
											>
												<GearIcon size={14} />
											</button>
											<button
												type="button"
												class="text-muted hover:text-default"
												aria-label={`Duplicate ${variable.name}`}
												onclick={() =>
													ui.attempt(() => ctx.variables.duplicateVariable(variable.id))}
											>
												<CopyIcon size={14} />
											</button>
											<button
												type="button"
												class="text-muted hover:text-default"
												aria-label={`Delete ${variable.name}`}
												onclick={() => ui.attempt(() => ctx.variables.removeVariable(variable.id))}
											>
												<TrashIcon size={14} />
											</button>
										</div>
									</div>
									{#if ui.expandedVariableId === variable.id}
										<div
											class="bg-raised border-line-faint flex flex-col gap-2 border-b px-3 py-2"
											data-variable-details={variable.id}
										>
											{#if SCOPES_BY_TYPE[variable.resolvedType].length > 0}
												<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
													<span class="text-muted">Scopes</span>
													{#each SCOPES_BY_TYPE[variable.resolvedType] as scope (scope)}
														<label class="flex items-center gap-1">
															<Checkbox
																size="sm"
																checked={variable.scopes.includes(scope)}
																aria-label={`Scope ${scopeLabel(scope)}`}
																onchange={(event: Event) => {
																	if (event.currentTarget instanceof HTMLInputElement) {
																		toggleScope(variable, scope, event.currentTarget.checked);
																	}
																}}
															/>
															{scopeLabel(scope)}
														</label>
													{/each}
													<span class="text-faint">None selected shows it everywhere</span>
												</div>
											{/if}
											<div class="flex items-center gap-3">
												<span class="text-muted">Code syntax</span>
												{#each PLATFORMS as platform (platform)}
													<input
														class="bg-input border-line text-default h-7 w-48 rounded border px-2"
														placeholder={platform}
														aria-label={`Code syntax ${platform}`}
														value={syntaxOf(variable, platform)}
														onchange={(event) =>
															setSyntax(variable, platform, event.currentTarget.value)}
													/>
												{/each}
											</div>
										</div>
									{/if}
								{/each}
							{:else}
								<p class="text-faint p-4">No variables in this collection yet.</p>
							{/each}
						</div>

						<div class="border-line-faint flex shrink-0 items-center gap-2 border-t px-3 py-2">
							<span class="text-muted">Create variable</span>
							{#each NEW_VARIABLE as entry (entry.type)}
								<Button
									size="sm"
									variant="ghost"
									onclick={() => addVariable(entry.type, entry.label)}
								>
									{entry.label}
								</Button>
							{/each}
						</div>
					{/if}
				</section>
			</div>

			{#if ui.error !== ''}
				<div
					class="bg-red-soft text-red flex shrink-0 items-center gap-2 rounded-b-lg px-4 py-2"
					role="alert"
					data-variables-error
				>
					<span class="flex-1">{ui.error}</span>
					<button type="button" aria-label="Dismiss error" onclick={() => ui.dismissError()}>
						<XIcon size={12} />
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
