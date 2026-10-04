import type { Context } from '@neoworks/extension-system';
import FrameCornersIcon from 'phosphor-svelte/lib/FrameCornersIcon';
import { createNode } from '../../lib/document';
import {
	CreationPreview,
	createCreationTool,
	type CreationToolSpec
} from '../../lib/editing/creationTool.svelte';
import CreationPreviewOverlay from '../../lib/editing/CreationPreviewOverlay.svelte';
import FrameLabels from './FrameLabels.svelte';
import { FramePresetState } from './framePresets.svelte';
import PresetList from './PresetList.svelte';

// The frame tool (F): drag or click to create a frame, nested into the frame under the pointer.
// While the tool is active the Design tab lists device and paper presets; the labels above
// top-level frames are an overlay and select the frame on click.
export default {
	name: 'tool-frame',
	inject: ['tools', 'document', 'selection', 'viewport', 'regions', 'panels'],
	apply(ctx: Context): void {
		const preview = new CreationPreview();
		const presetState = new FramePresetState();

		const spec: CreationToolSpec = {
			nodeType: 'FRAME',
			label: 'Frame',
			geometry: 'box',
			build: (placement, name) =>
				createNode('FRAME', {
					name,
					...placement,
					fills: [
						{
							type: 'SOLID',
							visible: true,
							opacity: 1,
							blendMode: 'NORMAL',
							color: { r: 1, g: 1, b: 1 }
						}
					]
				}),
			clickSize: () => {
				const preset = presetState.armed;
				if (!preset) return { width: 100, height: 100 };
				return { width: preset.width, height: preset.height };
			},
			nameOverride: () => presetState.armed?.name,
			onCreated: () => {
				presetState.armed = null;
			}
		};
		const handlers = createCreationTool(ctx, spec, preview);

		ctx.effect(
			() =>
				ctx.tools.register({
					id: 'frame',
					title: 'Frame',
					icon: FrameCornersIcon,
					shortcut: 'F',
					group: 'create',
					order: 10,
					cursor: 'crosshair',
					overlay: { component: CreationPreviewOverlay, props: { preview } },
					...handlers,
					onDeactivate: () => {
						handlers.onDeactivate?.();
						presetState.armed = null;
					}
				}),
			'frame tool'
		);

		ctx.effect(
			() =>
				ctx.panels.registerSection({
					tab: 'design',
					id: 'frame-presets',
					title: 'Frame',
					order: -10,
					visible: () => ctx.tools.activeId() === 'frame',
					component: PresetList,
					props: { presetState }
				}),
			'frame presets section'
		);

		ctx.effect(
			() =>
				ctx.regions.register({
					id: 'tool-frame/labels',
					region: 'canvas-overlay',
					component: FrameLabels
				}),
			'frame labels overlay'
		);
	}
};
