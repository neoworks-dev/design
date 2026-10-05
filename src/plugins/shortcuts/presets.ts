import type { KeyPresetInput } from '../../lib/registries/keymap.svelte';

export const FIGMA_PRESET_ID = 'figma';
export const PENPOT_PRESET_ID = 'penpot';

// The shipped bindings of the plugins are the Figma ones, so this preset replaces nothing.
export const FIGMA_PRESET: KeyPresetInput = {
	id: FIGMA_PRESET_ID,
	title: 'Figma',
	bindings: []
};

// docs/research/interactions.md section 15: Board B, Ellipse E, Curve Shift+C, Image K. Figma's
// Scale tool also sits on K, so it stays unbound here.
export const PENPOT_PRESET: KeyPresetInput = {
	id: PENPOT_PRESET_ID,
	title: 'Penpot',
	bindings: [
		{ command: 'tools.activate.frame', key: 'B' },
		{ command: 'tools.activate.ellipse', key: 'E' },
		{ command: 'tools.activate.pencil', key: 'Shift+C' },
		{ command: 'tools.activate.image', key: 'K' },
		{ command: 'tools.activate.scale', key: null }
	]
};
