import type { Context } from '@neoworks/extension-system';
import { BUILTIN_PROVIDERS } from '../../lib/codegen/providers';
import { CodegenService } from '../../lib/services/codegen';
import { watchHoverMeasurements } from './hoverMeasure.svelte';
import InspectPanel from './InspectPanel.svelte';
import ReadyForDevSection from './ReadyForDevSection.svelte';

// Dev Mode's read-only side: the Inspect tab (properties as a list or as code, box model, ready
// for dev, comparison with the main component), the `codegen` service with CSS, SVG and JSON
// providers, hover measurements without Alt, and the list of frames marked ready for dev in the
// left sidebar. Ready status lives in the node's `pluginData` under this plugin's id.
export default {
	name: 'inspect-panel',
	inject: ['panels', 'selection', 'document', 'variables', 'snapping'],
	apply(ctx: Context): void {
		const codegen = new CodegenService(ctx, ctx.document, ctx.variables);
		for (const provider of BUILTIN_PROVIDERS) {
			ctx.effect(() => codegen.register(provider), `codegen ${provider.id}`);
		}

		ctx.effect(
			() =>
				ctx.panels.registerTab({
					id: 'inspect',
					side: 'right',
					title: 'Inspect',
					order: 2,
					when: "mode == 'dev'",
					component: InspectPanel,
					props: { codegen }
				}),
			'inspect tab'
		);
		ctx.effect(
			() =>
				ctx.panels.registerSection({
					tab: 'file',
					id: 'ready-for-dev',
					title: 'Ready for dev',
					order: 5,
					when: "mode == 'dev'",
					component: ReadyForDevSection
				}),
			'ready for dev section'
		);
		ctx.effect(() => watchHoverMeasurements(ctx), 'hover measurements');
	}
};
