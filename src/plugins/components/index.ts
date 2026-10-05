import type { Context } from '@neoworks/extension-system';
import {
	createComponent,
	createInstances,
	detachInstances,
	goToMain,
	pushOverrides,
	resetOverrides,
	restoreMainComponent
} from '../../lib/components/actions';
import { publishComponentContextKeys } from '../../lib/components/contextKeys';
import { drawComponentLabels, LabelIndex, trackComponentLabels } from '../../lib/components/labels';
import { contributeCommand } from '../../lib/editing/contribute';
import ComponentSection from './ComponentSection.svelte';
import InstanceSection from './InstanceSection.svelte';

const SELECTION_MENUS = ['context/canvas', 'context/layer'];

function placements(order: number): { menu: string; group: string; order: number }[] {
	return SELECTION_MENUS.map((menu) => ({ menu, group: '3_component', order }));
}

// The component lifecycle on the canvas: create a component from the selection (Ctrl+Alt+K),
// make instances of it, detach (Ctrl+Alt+B) and go to the main component. Draws the purple
// labels over main components and sets, and contributes the Design sections for a selected main
// component and for an instance. The engine that keeps instances in sync is `component-sync`.
export default {
	name: 'components',
	inject: [
		'componentSync',
		'document',
		'selection',
		'commands',
		'keymap',
		'menus',
		'contextKeys',
		'inspectors',
		'overlay',
		'viewport',
		'panels'
	],
	apply(ctx: Context): void {
		publishComponentContextKeys(ctx);

		const labels = new LabelIndex();
		ctx.effect(
			() =>
				ctx.overlay.register({
					id: 'components/labels',
					order: 4,
					track: () => trackComponentLabels(ctx),
					draw: (frame) => drawComponentLabels(ctx, frame, labels)
				}),
			'components/overlay labels'
		);

		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'component',
					tab: 'design',
					title: 'Component',
					order: 5,
					applies: (selection) => selection.count === 1 && selection.kind === 'COMPONENT',
					component: ComponentSection
				}),
			'components/component section'
		);
		ctx.effect(
			() =>
				ctx.inspectors.register({
					id: 'instance',
					tab: 'design',
					title: 'Instance',
					order: 5,
					applies: (selection) =>
						selection.count === 1 &&
						ctx.componentSync.instanceOf(ctx.selection.ids[0]) !== undefined,
					component: InstanceSection
				}),
			'components/instance section'
		);

		contributeCommand(ctx, {
			id: 'components.create',
			title: 'Create component',
			when: 'canCreateComponent',
			run: () => createComponent(ctx),
			keys: ['Mod+Alt+K'],
			menus: placements(0)
		});
		contributeCommand(ctx, {
			id: 'components.create-instance',
			title: 'Create instance',
			when: 'selectionHasMain || selectionHasInstance',
			run: () => createInstances(ctx),
			keys: ['Shift+I'],
			menus: placements(1)
		});
		contributeCommand(ctx, {
			id: 'components.detach',
			title: 'Detach instance',
			when: 'selectionHasInstance',
			run: () => detachInstances(ctx),
			keys: ['Mod+Alt+B'],
			menus: placements(2)
		});
		contributeCommand(ctx, {
			id: 'components.go-to-main',
			title: 'Go to main component',
			when: 'selectionHasInstance',
			run: () => goToMain(ctx),
			menus: placements(3)
		});
		contributeCommand(ctx, {
			id: 'components.reset-overrides',
			title: 'Reset overrides',
			when: 'selectionHasOverrides',
			run: () => resetOverrides(ctx),
			menus: placements(4)
		});
		contributeCommand(ctx, {
			id: 'components.push-overrides',
			title: 'Push overrides to main component',
			when: 'selectionHasOverrides',
			run: () => pushOverrides(ctx),
			menus: placements(5)
		});
		contributeCommand(ctx, {
			id: 'components.restore-main',
			title: 'Restore main component',
			when: 'selectionHasOrphan',
			run: () => restoreMainComponent(ctx),
			menus: placements(6)
		});
		contributeCommand(ctx, {
			id: 'components.compare-with-main',
			title: 'Compare with main component',
			when: 'selectionHasInstance',
			run: () => ctx.panels.activateTab('inspect')
		});
	}
};
