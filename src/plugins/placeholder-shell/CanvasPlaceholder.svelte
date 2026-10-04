<script lang="ts">
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
	const platform = window.desktop?.system.platform ?? 'browser';
</script>

<!-- The real canvas input router replaces this; right click shows the empty-canvas context menu. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="text-faint flex flex-1 items-center justify-center text-sm"
	style:background-image="radial-gradient(var(--border) 1px, transparent 1px)"
	style:background-size="20px 20px"
	oncontextmenu={(event) => ctx.menus.openFromEvent('canvas-empty', event)}
>
	Canvas, running on {platform}
</div>
