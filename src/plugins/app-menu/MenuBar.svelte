<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';
	import type { ResolvedMenuItem } from '../../lib/registries/menus.svelte';
	import { APP_MENU } from './mirror.svelte';

	const ctx = getKernel();

	const menus = $derived(
		ctx.menus.resolve(APP_MENU).filter((item) => item.submenuPath !== undefined)
	);
	const openPath = $derived(ctx.menus.popup?.menu);

	function open(event: MouseEvent, item: ResolvedMenuItem): void {
		const path = item.submenuPath;
		if (path === undefined) return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		ctx.menus.openMenu(path, { x: rect.left, y: rect.bottom + 2 });
	}
</script>

<nav class="app-no-drag flex shrink-0 items-center gap-0.5 px-2" aria-label="Menu" data-menu-bar>
	{#each menus as item (item.id)}
		<button
			type="button"
			aria-haspopup="menu"
			aria-expanded={openPath === item.submenuPath}
			data-menu-bar-item={item.id}
			class="text-muted hover:bg-hover hover:text-default aria-expanded:bg-hover aria-expanded:text-default rounded-md px-2 py-1 text-xs"
			onclick={(event) => open(event, item)}
		>
			{item.title}
		</button>
	{/each}
</nav>
