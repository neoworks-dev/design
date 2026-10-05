import type { Context } from '@neoworks/extension-system';
import PenNibStraightIcon from 'phosphor-svelte/lib/PenNibStraightIcon';
import { contributeCommand } from '../../lib/editing/contribute';
import { toggleBucket } from '../../lib/vector/editAdvanced';
import { VectorEditState } from '../../lib/vector/editState';
import {
	createEditTool,
	editOverlay,
	VECTOR_EDIT_TOOL_ID,
	VectorEditor
} from '../../lib/vector/editTool';
import VertexSection from './VertexSection.svelte';

const EDITING = "activeTool == 'vector-edit'";
const CONTEXT_MENU = 'context/canvas';

// The vector edit mode: entered with Enter or a double click on a vector (the `canvas/edit-request`
// event), left with Esc or Enter. Select vertices and segments by click, Shift-click or marquee,
// drag to move, arrows to nudge, Delete removes a vertex with its segments, Shift+Delete heals
// (reconnects the neighbours), Ctrl+J joins two endpoints. Each gesture is one undo step. The
// mode is a tool that is not on the toolbar; points, handles and the marquee are drawn through
// the overlay service; the selected vertices get a Vertex section in the design tab (handle
// mirroring and corner radius), Ctrl is the bend tool and B the paint bucket. The context menu entries (Flatten, Join, Delete) wait for a menu host.
export default {
	name: 'vector-edit',
	inject: [
		'tools',
		'document',
		'selection',
		'viewport',
		'overlay',
		'commands',
		'keymap',
		'menus',
		'panels'
	],
	apply(ctx: Context): void {
		const state = new VectorEditState();
		const editor = new VectorEditor(ctx, state);

		ctx.effect(
			() =>
				ctx.tools.register({
					id: VECTOR_EDIT_TOOL_ID,
					title: 'Edit vector',
					icon: PenNibStraightIcon,
					cursor: () => {
						void state.revision.value;
						return state.bucket ? 'crosshair' : 'default';
					},
					toolbar: false,
					...createEditTool(editor)
				}),
			'vector edit tool'
		);
		ctx.effect(() => ctx.overlay.register(editOverlay(editor)), 'vector edit overlay');
		ctx.effect(
			() =>
				ctx.panels.registerSection({
					tab: 'design',
					id: 'vector-vertex',
					title: 'Vertex',
					order: -5,
					visible: () => {
						void state.revision.value;
						return state.active && state.selectedVertices.size > 0;
					},
					component: VertexSection,
					props: { editor }
				}),
			'vertex section'
		);
		ctx.on('canvas/edit-request', (id, kind) => {
			if (kind === 'vector') editor.enter(id);
		});

		contributeCommand(ctx, {
			id: 'vector.delete',
			title: 'Delete',
			when: EDITING,
			run: () => editor.deleteSelected(false),
			menus: [{ menu: CONTEXT_MENU, group: '9_vector', order: 3 }]
		});
		contributeCommand(ctx, {
			id: 'vector.delete-and-heal',
			title: 'Delete and heal',
			when: EDITING,
			run: () => editor.deleteSelected(true)
		});
		contributeCommand(ctx, {
			id: 'vector.join',
			title: 'Join',
			when: EDITING,
			run: () => editor.joinSelected(),
			menus: [{ menu: CONTEXT_MENU, group: '9_vector', order: 2 }]
		});
		contributeCommand(ctx, {
			id: 'vector.flatten',
			title: 'Flatten',
			when: EDITING,
			run: () => editor.flatten(),
			menus: [{ menu: CONTEXT_MENU, group: '9_vector', order: 1 }]
		});
		contributeCommand(ctx, {
			id: 'vector.paint-bucket',
			title: 'Paint bucket',
			when: EDITING,
			run: () => toggleBucket(editor)
		});
		contributeCommand(ctx, {
			id: 'vector.exit',
			title: 'Exit vector editing',
			when: EDITING,
			run: () => editor.exit()
		});
	}
};
