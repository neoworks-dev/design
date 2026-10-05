<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { suffixForConstraint } from '../../lib/export/settings';
	import { getKernel } from '../../lib/kernel/context';
	import IconButton from '../../lib/ui/IconButton.svelte';

	const ctx = getKernel();

	const ids = $derived(ctx.selection.ids.filter((id) => ctx.document.has(id)));

	// A new setting repeats the last one's size and format, so adding @2x then @3x is quick.
	function addSetting(): void {
		const [first] = ids;
		if (first === undefined) return;
		const last = ctx.export.settingsOf(first).at(-1);
		if (last === undefined) {
			ctx.export.addSetting(ids);
			return;
		}
		const constraint = { ...last.constraint };
		ctx.export.addSetting(ids, {
			suffix: suffixForConstraint(constraint),
			format: last.format,
			constraint
		});
	}
</script>

<IconButton icon={PlusIcon} label="Add export setting" onclick={addSetting} />
