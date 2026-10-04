import type { Context, Plugin } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';
import { describePlugin, mountPlugin } from '../../lib/kernel/testing';
import { DrawHookRegistry, type DrawHooks } from '../../lib/renderer/draw/hooks';
import { SkiaTracker } from '../../lib/renderer/ownership';
import paintShaders from './index';

function providers(registry: DrawHookRegistry): Plugin[] {
	return [
		{
			name: 'fake-renderer-images-canvaskit',
			inject: [],
			apply(ctx: Context): void {
				ctx.provide('renderer', {
					registerDrawHooks: (hooks: Partial<DrawHooks>) => registry.register(hooks)
				});
				ctx.provide('images', {
					peek: () => undefined,
					status: () => 'missing'
				});
				ctx.provide('canvaskit', { kit: {}, tracker: new SkiaTracker() });
			}
		} as Plugin
	];
}

const sharedRegistry = new DrawHookRegistry();

describePlugin('paint-shaders', paintShaders, {
	providers: providers(sharedRegistry),
	contributes: () => {
		expect(sharedRegistry.registrations).toBe(1);
	}
});

describe('DrawHookRegistry', () => {
	it('removes a registration by identity and keeps the others', () => {
		const registry = new DrawHookRegistry();
		const first: Partial<DrawHooks> = {};
		const second: Partial<DrawHooks> = {};
		const removeFirst = registry.register(first);
		registry.register(second);
		removeFirst();
		removeFirst();
		expect(registry.registrations).toBe(1);
	});

	it('runs every drawing hook oldest first and asks for shaders newest first', () => {
		const registry = new DrawHookRegistry();
		const calls: string[] = [];
		registry.register({
			drawText: () => calls.push('text-a'),
			shaderForPaint: () => {
				calls.push('shader-a');
				return null;
			}
		});
		registry.register({
			drawText: () => calls.push('text-b'),
			shaderForPaint: () => {
				calls.push('shader-b');
				return null;
			}
		});
		const context = {} as never;
		registry.drawText(context, {} as never);
		expect(registry.shaderForPaint(context, {} as never, { width: 1, height: 1 })).toBeNull();
		expect(calls).toEqual(['text-a', 'text-b', 'shader-b', 'shader-a']);
	});
});

describe('paint-shaders', () => {
	it('registers one shader hook with the renderer and removes it on unload', async () => {
		const registry = new DrawHookRegistry();
		const mounted = await mountPlugin(paintShaders, { providers: providers(registry) });
		expect(registry.registrations).toBe(1);
		await mounted.fiber.dispose();
		expect(registry.registrations).toBe(0);
		await mounted.cleanup();
	});
});
