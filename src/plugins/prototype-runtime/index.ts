import type { Context } from '@neoworks/extension-system';
import { PrototypePlayerService } from '../../lib/services/prototypePlayer';
import PlayerView from './PlayerView.svelte';

// The prototype runtime (#123): provides `prototypePlayer`. A session interprets the interactions
// of the document (navigate, back, overlays, swap, scroll to, open link, set variable) with the
// state machine in lib/prototype/machine.ts, and `view` plays it: frames are rendered by the
// headless renderer, pointer, hover, drag, key and delay triggers are wired to hotspots over the
// nodes that have interactions, transitions (dissolve, move, push, slide) animate between frames,
// and frames with overflow scrolling scroll inside their box while fixed children stay put.
// Smart animate plays as a dissolve (it needs layer matching, a deferred risk item); set variable
// updates the session's variables but nothing reads them yet.
export default {
	name: 'prototype-runtime',
	inject: ['document', 'prototyping', 'headlessRenderer', 'spatial'],
	apply(ctx: Context): void {
		new PrototypePlayerService(
			ctx,
			ctx.document,
			ctx.prototyping,
			ctx.headlessRenderer,
			ctx.spatial,
			PlayerView
		);
	}
};
