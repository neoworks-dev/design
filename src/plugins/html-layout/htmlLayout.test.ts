import type { Context, Plugin } from '@neoworks/extension-system';
import { expect } from 'vitest';
import { describePlugin } from '../../lib/kernel/testing';
import htmlLayout from './index';

const fakeFonts = {
	name: 'fake-fonts',
	inject: [],
	apply(ctx: Context): void {
		ctx.provide('fonts', { families: () => [], faces: () => [], load: () => Promise.reject() });
	}
} as Plugin;

describePlugin('html-layout', htmlLayout, {
	providers: [fakeFonts],
	contributes: ({ ctx }) => {
		expect(typeof ctx.htmlLayout.measure).toBe('function');
	}
});
