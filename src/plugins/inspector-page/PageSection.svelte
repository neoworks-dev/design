<script lang="ts">
	import type { Paint, SolidPaint } from '../../lib/document';
	import { getKernel } from '../../lib/kernel/context';
	import { colorToHex } from '../../lib/ui/color';
	import NumberField from '../../lib/ui/NumberField.svelte';
	import type { NumberGesture } from '../../lib/ui/numberField';

	const ctx = getKernel();

	const page = $derived(ctx.document.currentPage);
	const background = $derived.by((): SolidPaint | null => {
		const [first] = page.backgrounds;
		if (first === undefined || first.type !== 'SOLID') return null;
		return first;
	});

	function editBackground(
		change: (paint: SolidPaint) => SolidPaint,
		label: string,
		gesture: NumberGesture
	): void {
		const [first, ...rest] = ctx.document.currentPage.backgrounds;
		if (first === undefined || first.type !== 'SOLID') return;
		const backgrounds: Paint[] = [change(first), ...rest];
		let mergeKey: string | undefined;
		if (gesture !== 'commit') mergeKey = `page-background:${page.id}`;
		ctx.document.apply(ctx.document.setProps(page.id, { backgrounds }), {
			origin: 'user',
			label,
			mergeKey
		});
	}

	function openPicker(event: MouseEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		const box = event.currentTarget.getBoundingClientRect();
		ctx.colorPicker.open({
			anchor: { x: box.left, y: box.top, width: box.width, height: box.height },
			label: 'Page background',
			scope: 'FILL',
			color: () => {
				if (background === null) return { r: 0.96, g: 0.96, b: 0.96, a: 1 };
				return { ...background.color, a: background.opacity };
			},
			onchange: (color, gesture) =>
				editBackground(
					(paint) => ({ ...paint, color: { r: color.r, g: color.g, b: color.b } }),
					'Change page background',
					gesture
				)
		});
	}

	function setOpacity(percent: number, gesture: NumberGesture): void {
		editBackground(
			(paint) => ({ ...paint, opacity: percent / 100 }),
			'Change page background opacity',
			gesture
		);
	}
</script>

<div class="flex items-center gap-2 px-4 pb-4" data-page-section>
	{#if background === null}
		<span class="text-faint text-xs">No background</span>
	{:else}
		<button
			type="button"
			aria-label="Page background"
			class="border-line size-6 shrink-0 cursor-pointer rounded border"
			style:background={colorToHex(background.color)}
			onclick={openPicker}
		></button>
		<span class="text-default flex-1 text-xs uppercase tabular-nums">
			{colorToHex(background.color)}
		</span>
		<div class="w-20">
			<NumberField
				label="%"
				name="Page background opacity"
				min={0}
				max={100}
				value={Math.round(background.opacity * 100)}
				onchange={setOpacity}
			/>
		</div>
	{/if}
</div>
