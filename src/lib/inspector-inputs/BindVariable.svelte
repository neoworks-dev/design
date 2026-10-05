<script lang="ts">
	import HexagonIcon from 'phosphor-svelte/lib/HexagonIcon';
	import { generateNodeId, type Node, type VariableType } from '../document';
	import { getKernel } from '../kernel/context';
	import Popover from '../ui/Popover.svelte';
	import { bindableVariables, leafNameOf } from '../variables/organize';
	import { boundVariableId } from './values';

	// The "apply variable" button of a numeric or text field: opens a popover with the variables
	// whose type and scopes fit the property, and unbinds. Used in the `trailing` slot of
	// `NumberField`; colours bind through the colour picker instead.
	let {
		nodes,
		property,
		scopes,
		type = 'FLOAT',
		label
	}: {
		nodes: readonly Node[];
		property: string;
		/** Variable scopes that may bind to this field (a variable with none fits anywhere). */
		scopes: string[];
		type?: VariableType;
		/** Accessible name of the field, for example "Gap". */
		label: string;
	} = $props();

	const ctx = getKernel();

	let anchor = $state<{ x: number; y: number; width: number; height: number } | null>(null);
	let search = $state('');
	let error = $state('');

	const boundId = $derived(
		boundVariableId(
			nodes.map((node) => ctx.document.require(node.id)),
			property
		)
	);
	const candidates = $derived(
		bindableVariables(ctx.variables.variables(), type, scopes).filter((variable) =>
			variable.name.toLowerCase().includes(search.toLowerCase())
		)
	);

	function open(event: MouseEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const rect = event.currentTarget.getBoundingClientRect();
		anchor = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
		search = '';
		error = '';
	}

	function close(): void {
		anchor = null;
	}

	// One `runId` folds the edits of every selected node into a single undo step.
	function inOneStep(edit: (nodeId: string, meta: { runId: string }) => void): void {
		const meta = { runId: generateNodeId() };
		try {
			for (const node of nodes) edit(node.id, meta);
			error = '';
		} catch (failure) {
			if (failure instanceof Error) error = failure.message;
			else error = String(failure);
		}
	}

	function bind(variableId: string): void {
		inOneStep((nodeId, meta) => ctx.variables.bindVariable(nodeId, property, variableId, meta));
		if (error === '') close();
	}

	function unbind(): void {
		inOneStep((nodeId, meta) => ctx.variables.unbind(nodeId, property, meta));
		if (error === '') close();
	}
</script>

<button
	type="button"
	aria-label="Apply variable to {label}"
	title="Apply variable"
	data-bind-variable={property}
	class={[
		'text-muted hover:text-default flex size-5 items-center justify-center rounded-sm',
		boundId === null && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
		boundId !== null && 'text-action'
	]}
	onclick={open}
>
	<HexagonIcon size={12} weight={boundId === null ? 'regular' : 'fill'} />
</button>

{#if anchor !== null}
	<Popover {anchor} label="Apply variable to {label}" width={220} onclose={close}>
		<div class="flex flex-col gap-1 p-2 text-xs" data-bind-popover>
			<input
				class="bg-input border-line text-default h-7 rounded border px-2"
				placeholder="Search variables"
				aria-label="Search variables"
				bind:value={search}
			/>
			<ul class="flex max-h-56 flex-col overflow-y-auto">
				{#each candidates as variable (variable.id)}
					<li>
						<button
							type="button"
							class={[
								'hover:bg-hover flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left',
								variable.id === boundId && 'bg-raised'
							]}
							data-bind-option={variable.id}
							onclick={() => bind(variable.id)}
						>
							<span class="truncate">{leafNameOf(variable.name)}</span>
							<span class="text-faint truncate">{variable.name}</span>
						</button>
					</li>
				{:else}
					<li class="text-faint px-2 py-1">No matching variables</li>
				{/each}
			</ul>
			{#if boundId !== null}
				<button
					type="button"
					class="text-muted hover:text-default hover:bg-hover rounded px-2 py-1 text-left"
					data-unbind-variable
					onclick={unbind}
				>
					Detach variable
				</button>
			{/if}
			{#if error !== ''}
				<p class="text-red px-2" role="alert">{error}</p>
			{/if}
		</div>
	</Popover>
{/if}
