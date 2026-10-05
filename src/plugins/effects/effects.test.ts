import type { Context, Plugin } from '@neoworks/extension-system';
import { expect } from 'vitest';
import { describePlugin } from '../../lib/kernel/testing';
import { DrawHookRegistry, type DrawHooks } from '../../lib/renderer/draw/hooks';
import effects from './index';

const registry = new DrawHookRegistry();

const fakeRenderer = {
	name: 'fake-renderer',
	inject: [],
	apply(ctx: Context): void {
		ctx.provide('renderer', {
			registry,
			registerDrawHooks: (hooks: Partial<DrawHooks>) => registry.register(hooks)
		});
	}
} as Plugin;

describePlugin('effects', effects, {
	providers: [fakeRenderer],
	contributes: () => {
		expect(registry.registrations).toBe(1);
	}
});
