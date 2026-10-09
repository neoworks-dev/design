<script lang="ts">
	import type { Component } from 'svelte';

	interface GroupButton {
		/** Accessible name and default tooltip. */
		label: string;
		// phosphor-svelte icons accept more props than `size` and `weight`
		// oxlint-disable-next-line typescript/no-explicit-any
		icon: Component<any>;
		onclick: (event: MouseEvent) => void;
		disabled?: boolean;
		/** Tooltip override, for example the reason a button is disabled. */
		title?: string;
		/** Toggle state (`aria-pressed`); leave undefined for a plain action button. */
		pressed?: boolean;
	}

	let { buttons, name }: { buttons: GroupButton[]; name: string } = $props();
</script>

<!-- Figma's connected icon buttons (align, rotate and flip): one field-coloured pill. -->
<div
	role="group"
	aria-label={name}
	class="bg-input flex h-8 min-w-0 items-center rounded-md"
	data-button-group={name}
>
	{#each buttons as button (button.label)}
		<button
			type="button"
			aria-label={button.label}
			aria-pressed={button.pressed}
			title={button.title === undefined ? button.label : button.title}
			disabled={button.disabled}
			class={[
				'flex h-full min-w-0 flex-1 items-center justify-center rounded-md transition-colors disabled:opacity-40',
				button.pressed === true
					? 'bg-hover text-default'
					: 'text-muted hover:bg-hover hover:text-default disabled:hover:bg-transparent'
			]}
			onclick={button.onclick}
		>
			<button.icon size={16} />
		</button>
	{/each}
</div>
