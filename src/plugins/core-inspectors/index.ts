import type { Context } from '@neoworks/extension-system';
import { InspectorsService, type SelectionSource } from '../../lib/registries/inspectors.svelte';

function isSelectionSource(value: unknown): value is SelectionSource {
	if (typeof value !== 'object' || value === null) return false;
	return typeof Reflect.get(value, 'nodes') === 'function';
}

// The `inspectors` service. It needs only `panels` to be active; the `selection` service is
// connected through an inject block, so inspectors work (with an empty selection) before the
// selection plugin exists and pick it up as soon as it is provided.
export default {
	name: 'core-inspectors',
	inject: ['panels'],
	apply(ctx: Context): void {
		const inspectors = new InspectorsService(ctx, ctx.panels);

		ctx.inject(['selection'], (withSelection) => {
			const selection: unknown = Reflect.get(withSelection, 'selection');
			if (!isSelectionSource(selection)) {
				withSelection.logger.warn('the selection service has no nodes(); inspectors stay empty');
				return;
			}
			withSelection.effect(
				() => inspectors.setSelectionSource(selection),
				'inspectors/selection source'
			);
		});
	}
};
