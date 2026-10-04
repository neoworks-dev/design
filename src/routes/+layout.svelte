<script lang="ts">
	import './layout.css';

	let { children } = $props();
</script>

<div class="bg-canvas text-default flex h-screen w-screen flex-col overflow-hidden">
	{@render children()}
</div>
