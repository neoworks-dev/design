import type { Context, Plugin } from '@neoworks/extension-system';
import { expect } from 'vitest';
import { describePlugin } from '../../lib/kernel/testing';
import { DrawHookRegistry } from '../../lib/renderer/draw/hooks';
import { SkiaTracker } from '../../lib/renderer/ownership';
import headlessRenderer from './index';

const fakeDependencies = {
	name: 'fake-headless-dependencies',
	inject: [],
	apply(ctx: Context): void {
		ctx.provide('renderer', { drawHooks: new DrawHookRegistry() });
		ctx.provide('canvaskit', { kit: {}, tracker: new SkiaTracker() });
		ctx.provide('document', {});
		ctx.provide('variables', {});
		ctx.provide('spatial', { sceneIndex: {} });
	}
} as Plugin;

describePlugin('headless-renderer', headlessRenderer, {
	providers: [fakeDependencies],
	contributes: ({ ctx }) => {
		expect(typeof ctx.headlessRenderer.exportNode).toBe('function');
	}
});
