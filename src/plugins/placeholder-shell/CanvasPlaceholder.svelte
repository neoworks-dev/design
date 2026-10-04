<script lang="ts">
	const platform = window.desktop?.system.platform ?? 'browser';
</script>

<div
	class="text-faint flex flex-1 items-center justify-center text-sm"
	style:background-image="radial-gradient(var(--border) 1px, transparent 1px)"
	style:background-size="20px 20px"
>
	Canvas, running on {platform}
</div>
