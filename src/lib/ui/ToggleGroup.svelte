<script lang="ts">
	import type { Component } from 'svelte';

	interface ToggleOption {
		value: string;
		/** Accessible name and tooltip. */
		label: string;
		// phosphor-svelte icons accept more props than `size` and `weight`
		// oxlint-disable-next-line typescript/no-explicit-any
		icon?: Component<any>;
		disabled?: boolean;
		/** Tooltip override, for example the reason an option is disabled. */
		title?: string;
	}

	let {
		options,
		value,
		name,
		mixed = false,
		onchange
	}: {
		options: ToggleOption[];
		/** The selected option; `null` or `mixed` leaves every option unpressed. */
		value: string | null;
		/** Accessible name of the group. */
		name: string;
		mixed?: boolean;
		onchange: (value: string) => void;
	} = $props();
</script>

<!-- Segmented buttons: icon toggles when options carry an icon, text otherwise. -->
<div
	role="group"
	aria-label={name}
	class="bg-input inline-flex h-8 items-center gap-0.5 rounded-md p-0.5"
	data-toggle-group={name}
>
	{#each options as option (option.value)}
		{@const pressed = !mixed && value === option.value}
		<button
			type="button"
			aria-label={option.label}
			aria-pressed={pressed}
			title={option.title === undefined ? option.label : option.title}
			disabled={option.disabled}
			class={[
				'flex h-full min-w-6 flex-1 items-center justify-center rounded px-1.5 text-xs transition-colors disabled:opacity-40',
				pressed
					? 'bg-canvas text-default shadow-sm'
					: 'text-muted hover:bg-hover hover:text-default'
			]}
			onclick={() => onchange(option.value)}
		>
			{#if option.icon}
				{@const Icon = option.icon}
				<Icon size={14} />
			{:else}
				{option.label}
			{/if}
		</button>
	{/each}
</div>
