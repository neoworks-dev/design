<script lang="ts">
	let { label = 'hello' }: { label?: string } = $props();
</script>

<p data-testid="hello">{label}</p>
