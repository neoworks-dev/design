<script lang="ts">
	import type { TextNode } from '../../lib/document';
	import { selectedNodes } from '../../lib/inspector-inputs/selectionEdit';
	import StyleButton from '../../lib/inspector-inputs/StyleButton.svelte';
	import { getKernel } from '../../lib/kernel/context';

	// Header control of the Typography section: text styles picker.
	const ctx = getKernel();
	const textNodes = $derived(
		selectedNodes(ctx).filter((node): node is TextNode => node.type === 'TEXT')
	);
</script>

<StyleButton target="text" nodes={textNodes} />
