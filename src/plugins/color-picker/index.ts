import type { Context } from '@neoworks/extension-system';
import { ColorPickerService } from '../../lib/services/colorPicker';
import { ColorPickerState } from '../../lib/services/colorPickerState.svelte';
import ColorPickerHost from './ColorPickerHost.svelte';

// The `colorPicker` service and its popover. Sections call `ctx.colorPicker.open(request)`.
export default {
	name: 'color-picker',
	inject: ['regions', 'document', 'variables'],
	apply(ctx: Context): void {
		const picker = new ColorPickerService(ctx, new ColorPickerState());
		ctx.effect(() => () => picker.close(), 'color picker closes');
		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'color-picker/popover',
					region: 'overlay',
					component: ColorPickerHost
				}),
			'color picker popover'
		);
	}
};
