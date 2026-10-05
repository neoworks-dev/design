<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';
	import { colorToHex } from '../../lib/ui/color';
	import ColorSwatch from '../../lib/ui/ColorSwatch.svelte';

	const ctx = getKernel();

	const page = $derived(ctx.document.currentPage);
	const background = $derived.by(() => {
		const [first] = page.backgrounds;
		if (first === undefined || first.type !== 'SOLID') return null;
		return first.color;
	});
</script>

<div class="flex items-center gap-2 px-3 pb-3" data-page-section>
	<ColorSwatch
		name="Page background"
		color={background}
		onchange={(color) => ctx.document.setPageBackground(page.id, color)}
	/>
	<span class="text-default text-xs uppercase tabular-nums">
		{background === null ? 'None' : colorToHex(background)}
	</span>
	<span class="text-faint text-xs">Background</span>
</div>
