<script lang="ts">
	import { Checkbox } from '@neoworks-dev/ui';
	import LinkBreakIcon from 'phosphor-svelte/lib/LinkBreakIcon';
	import LinkIcon from 'phosphor-svelte/lib/LinkIcon';
	import type { RGBA, Variable, VariableAlias, VariableValue } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import { colorToHex } from '../../lib/ui/color';
	import ColorSwatch from '../../lib/ui/ColorSwatch.svelte';
	import Popover from '../../lib/ui/Popover.svelte';
	import { leafNameOf } from '../../lib/variables/organize';

	// One value of a variable in one mode: an editor for its type, or the alias it points to.
	let { variable, modeId }: { variable: Variable; modeId: string } = $props();

	const ctx = getKernel();

	const value = $derived(variable.valuesByMode[modeId]);
	let picker = $state<{ x: number; y: number; width: number; height: number } | null>(null);

	function isAlias(candidate: VariableValue | undefined): candidate is VariableAlias {
		if (typeof candidate !== 'object') return false;
		return 'type' in candidate && candidate.type === 'VARIABLE_ALIAS';
	}

	function isColor(candidate: VariableValue | undefined): candidate is RGBA {
		if (typeof candidate !== 'object') return false;
		return 'r' in candidate;
	}

	const alias = $derived.by(() => {
		if (isAlias(value)) return value;
		return null;
	});
	const target = $derived.by(() => {
		if (alias === null) return undefined;
		return ctx.variables.variable(alias.id);
	});
	const targets = $derived(
		ctx.variables
			.variables()
			.filter((other) => other.resolvedType === variable.resolvedType && other.id !== variable.id)
	);

	function write(next: VariableValue): void {
		ctx.variablesUi.attempt(() => ctx.variables.setVariableValue(variable.id, modeId, next));
	}

	function setColor(next: { r: number; g: number; b: number }): void {
		let alpha = 1;
		if (isColor(value)) alpha = value.a;
		write({ ...next, a: alpha });
	}

	function setNumber(text: string): void {
		const parsed = Number.parseFloat(text);
		if (Number.isNaN(parsed)) return;
		write(parsed);
	}

	function openPicker(event: MouseEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const rect = event.currentTarget.getBoundingClientRect();
		picker = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
	}

	function link(targetId: string): void {
		picker = null;
		write({ type: 'VARIABLE_ALIAS', id: targetId });
	}

	// Detaching keeps what the alias resolves to for this mode.
	function unlink(): void {
		const resolved = ctx.variables.resolveVariable(variable.id);
		if (resolved === undefined) return;
		write(resolved);
	}
</script>

<div class="flex min-w-0 items-center gap-1" data-value-cell={`${variable.id}:${modeId}`}>
	{#if alias !== null}
		<span
			class="bg-raised text-default flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1"
			data-alias-chip
			title={target === undefined ? 'Missing variable' : target.name}
		>
			<LinkIcon size={12} />
			<span class="truncate"
				>{target === undefined ? 'Missing variable' : leafNameOf(target.name)}</span
			>
		</span>
		<button
			type="button"
			class="text-muted hover:text-default"
			aria-label="Detach alias"
			title="Detach alias"
			onclick={unlink}
		>
			<LinkBreakIcon size={14} />
		</button>
	{:else}
		{#if variable.resolvedType === 'COLOR' && isColor(value)}
			<ColorSwatch name={`${variable.name} color`} color={value} onchange={setColor} />
			<span class="text-muted flex-1 tabular-nums">{colorToHex(value).toUpperCase()}</span>
		{:else if variable.resolvedType === 'FLOAT' && typeof value === 'number'}
			<input
				class="bg-input border-line text-default h-7 min-w-0 flex-1 rounded border px-2 tabular-nums"
				aria-label={`${variable.name} value`}
				{value}
				onchange={(event) => setNumber(event.currentTarget.value)}
			/>
		{:else if variable.resolvedType === 'STRING' && typeof value === 'string'}
			<input
				class="bg-input border-line text-default h-7 min-w-0 flex-1 rounded border px-2"
				aria-label={`${variable.name} value`}
				{value}
				onchange={(event) => write(event.currentTarget.value)}
			/>
		{:else if variable.resolvedType === 'BOOLEAN'}
			<label class="flex flex-1 items-center gap-2">
				<Checkbox
					size="sm"
					checked={value === true}
					aria-label={`${variable.name} value`}
					onchange={(event: Event) => {
						if (event.currentTarget instanceof HTMLInputElement) write(event.currentTarget.checked);
					}}
				/>
				<span class="text-muted">{value === true ? 'True' : 'False'}</span>
			</label>
		{/if}
		<button
			type="button"
			class="text-muted hover:text-default"
			aria-label="Alias another variable"
			title="Alias another variable"
			data-alias-button
			onclick={openPicker}
		>
			<LinkIcon size={14} />
		</button>
	{/if}
</div>

{#if picker !== null}
	<Popover anchor={picker} label="Alias target" width={220} onclose={() => (picker = null)}>
		<ul class="flex max-h-64 flex-col overflow-y-auto p-1 text-xs" data-alias-list>
			{#each targets as other (other.id)}
				<li>
					<button
						type="button"
						class="hover:bg-hover flex w-full justify-between gap-2 rounded px-2 py-1 text-left"
						data-alias-option={other.id}
						onclick={() => link(other.id)}
					>
						<span class="truncate">{leafNameOf(other.name)}</span>
						<span class="text-faint truncate">{other.name}</span>
					</button>
				</li>
			{:else}
				<li class="text-faint px-2 py-1">
					No other {variable.resolvedType.toLowerCase()} variables
				</li>
			{/each}
		</ul>
	</Popover>
{/if}
