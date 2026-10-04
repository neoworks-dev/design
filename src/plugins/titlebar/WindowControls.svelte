<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../lib/kernel/context';

	const ctx = getKernel();
</script>

<div class="app-no-drag flex shrink-0 items-center gap-0.5 px-1.5" data-window-controls>
	<Button
		round
		size="sm"
		variant="ghost"
		icon={MinusIcon}
		onclick={() => void ctx.commands.run('titlebar.minimize')}
	/>
	<Button
		round
		size="sm"
		variant="ghost"
		icon={SquareIcon}
		onclick={() => void ctx.commands.run('titlebar.toggle-maximize')}
	/>
	<Button
		round
		size="sm"
		variant="ghost"
		icon={XIcon}
		onclick={() => void ctx.commands.run('titlebar.close')}
	/>
</div>
