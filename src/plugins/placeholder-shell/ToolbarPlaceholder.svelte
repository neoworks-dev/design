<script lang="ts">
	import { Button, Tooltip } from '@neoworks-dev/ui';
	import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircleIcon';
	import CursorIcon from 'phosphor-svelte/lib/CursorIcon';
	import FrameCornersIcon from 'phosphor-svelte/lib/FrameCornersIcon';
	import PenNibIcon from 'phosphor-svelte/lib/PenNibIcon';
	import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
	import TextTIcon from 'phosphor-svelte/lib/TextTIcon';

	const tools = [
		{ name: 'Move', icon: CursorIcon },
		{ name: 'Frame', icon: FrameCornersIcon },
		{ name: 'Rectangle', icon: SquareIcon },
		{ name: 'Pen', icon: PenNibIcon },
		{ name: 'Text', icon: TextTIcon },
		{ name: 'Comment', icon: ChatCircleIcon }
	];
	let activeTool = $state('Move');
</script>

<div
	role="toolbar"
	aria-label="Tools"
	class="bg-elevated border-line flex items-center gap-1 rounded-xl border p-1.5 shadow-lg"
>
	{#each tools as tool (tool.name)}
		<Tooltip text={tool.name} placement="top">
			<Button
				round
				size="sm"
				icon={tool.icon}
				variant={activeTool === tool.name ? 'primary' : 'ghost'}
				onclick={() => (activeTool = tool.name)}
			/>
		</Tooltip>
	{/each}
</div>
