import type { Context } from '@neoworks/extension-system';
import DesignHeader from './DesignHeader.svelte';

// The Design tab of the right sidebar: header (zoom, mode switch, node name). The property sections themselves are contributed by the
// inspector-* plugins through `inspectors`; this plugin only owns the frame they stack in.
export default {
	name: 'design-panel',
	inject: ['panels', 'inspectors', 'selection', 'document', 'viewport', 'commands'],
	apply(ctx: Context): void {
		ctx.effect(
			() =>
				ctx.panels.registerTab({
					id: 'design',
					side: 'right',
					title: 'Design',
					order: 0,
					shortcut: 'Alt+8',
					when: "mode == 'design'",
					component: DesignHeader
				}),
			'design tab'
		);
	}
};
