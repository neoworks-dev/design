<script lang="ts">
	import type { Context } from '@neoworks/extension-system';
	import { provideKernel } from '../../lib/kernel/context';
	import AiChatPanel from './AiChatPanel.svelte';

	// Test host: renders the panel with a plugin context, the way a region host does.
	let { ctx }: { ctx: Context } = $props();

	// svelte-ignore state_referenced_locally
	provideKernel(ctx);
</script>

<AiChatPanel />
