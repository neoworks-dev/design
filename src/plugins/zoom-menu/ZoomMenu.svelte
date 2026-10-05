<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import { getKernel } from '../../lib/kernel/context';
	import { parseZoomPercent, ZOOM_MENU } from './zoomValue';

	const ctx = getKernel();

	const label = $derived(`${Math.round(ctx.viewport.zoom * 100)}%`);
	let draft: string | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let wrapper: HTMLElement | undefined = $state();

	function commit(): void {
		const text = draft;
		draft = undefined;
		if (text === undefined) return;
		const percent = parseZoomPercent(text);
		if (percent === undefined) return;
		ctx.viewport.zoomTo(percent / 100);
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			commit();
			input?.blur();
		} else if (event.key === 'Escape') {
			draft = undefined;
			input?.blur();
		}
	}

	function openMenu(): void {
		if (!wrapper) return;
		const rect = wrapper.getBoundingClientRect();
		ctx.menus.openMenu(ZOOM_MENU, { x: rect.left, y: rect.bottom + 4 });
	}
</script>

<div
	bind:this={wrapper}
	class="app-no-drag hover:bg-hover my-1.5 flex shrink-0 items-center rounded-md"
	data-zoom-menu
>
	<input
		bind:this={input}
		type="text"
		inputmode="decimal"
		aria-label="Zoom level"
		class="text-muted focus:text-default focus:bg-input w-11 rounded-md bg-transparent px-1 text-right text-xs tabular-nums outline-none"
		value={draft ?? label}
		oninput={(event) => (draft = event.currentTarget.value)}
		onfocus={(event) => event.currentTarget.select()}
		onblur={commit}
		{onkeydown}
	/>
	<button
		type="button"
		aria-label="Zoom options"
		aria-haspopup="menu"
		class="text-muted hover:text-default flex h-full w-5 items-center justify-center"
		onclick={openMenu}
	>
		<CaretDownIcon size={10} weight="bold" />
	</button>
</div>
