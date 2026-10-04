<script lang="ts">
	import CopySimpleIcon from 'phosphor-svelte/lib/CopySimpleIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getKernel } from '../../lib/kernel/context';
	import IconButton from '../../lib/ui/IconButton.svelte';

	const ctx = getKernel();

	const maximized = $derived(ctx.contextKeys.get('window.maximized') === true);
	const maximizeIcon = $derived.by(() => {
		if (maximized) return CopySimpleIcon;
		return SquareIcon;
	});
	const maximizeLabel = $derived.by(() => {
		if (maximized) return 'Restore window';
		return 'Maximize window';
	});

	function run(commandId: string): void {
		void ctx.commands.run(commandId).catch((error: unknown) => ctx.logger.error(error));
	}
</script>

<div class="app-no-drag flex shrink-0 items-center gap-0.5 px-1.5" data-window-controls>
	<IconButton icon={MinusIcon} label="Minimize window" onclick={() => run('titlebar.minimize')} />
	<IconButton
		icon={maximizeIcon}
		label={maximizeLabel}
		onclick={() => run('titlebar.toggle-maximize')}
	/>
	<IconButton icon={XIcon} label="Close window" onclick={() => run('titlebar.close')} />
</div>
