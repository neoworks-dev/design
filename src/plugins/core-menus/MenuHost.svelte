<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';
	import type { ResolvedMenuItem } from '../../lib/registries/menus.svelte';
	import MenuList from './MenuList.svelte';
	import { placeWithinViewport } from './placement';

	const ctx = getKernel();

	const popup = $derived(ctx.menus.popup);
	const items = $derived.by(() => {
		if (!popup) return [];
		return ctx.menus.resolve(popup.menu);
	});

	function activate(item: ResolvedMenuItem): void {
		void ctx.menus.activate(item).catch((error: unknown) => ctx.logger.error(error));
	}
</script>

{#if popup}
	<!-- The backdrop swallows the click that dismisses the menu, like a native popup. -->
	<div
		class="pointer-events-auto fixed inset-0 z-50"
		role="presentation"
		data-menu-backdrop
		onpointerdown={() => ctx.menus.close()}
		oncontextmenu={(event) => {
			event.preventDefault();
			ctx.menus.close();
		}}
	></div>
	{#key popup}
		<div
			use:placeWithinViewport={'popup'}
			class="pointer-events-auto fixed z-50"
			style:left="{popup.point.x}px"
			style:top={popup.placement === 'below' ? `${popup.point.y}px` : undefined}
			style:bottom={popup.placement === 'above'
				? `${window.innerHeight - popup.point.y}px`
				: undefined}
			data-menu-popup={popup.kind}
		>
			{#if items.length > 0}
				<MenuList {items} onactivate={activate} onclose={() => ctx.menus.close()} />
			{/if}
		</div>
	{/key}
{/if}
