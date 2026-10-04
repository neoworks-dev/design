<script lang="ts">
	import { Button } from '@neoworks-dev/ui';

	const platform = window.desktop?.system.platform ?? 'browser';
</script>

<header class="app-drag border-line-faint flex h-10 items-center justify-between border-b px-3">
	<span class="text-sm font-medium">Untitled</span>
	<div class="app-no-drag flex gap-1">
		<Button onclick={() => window.desktop?.window.minimize()}>–</Button>
		<Button onclick={() => window.desktop?.window.toggleMaximize()}>□</Button>
		<Button onclick={() => window.desktop?.window.close()}>×</Button>
	</div>
</header>

<div class="flex min-h-0 flex-1">
	<aside class="border-line-faint w-60 border-r p-3 text-sm">Layers</aside>
	<main class="flex flex-1 items-center justify-center text-sm opacity-60">
		Canvas — running on {platform}
	</main>
	<aside class="border-line-faint w-60 border-l p-3 text-sm">Design</aside>
</div>
