import type { Context, Plugin } from '@neoworks/extension-system';
import { expect } from 'vitest';
import { describePlugin } from '../../lib/kernel/testing';
import { ExportService } from '../../lib/services/export';
import exportRaster from './index';

const fakeDependencies = {
	name: 'fake-raster-dependencies',
	inject: [],
	apply(ctx: Context): void {
		new ExportService(ctx);
		ctx.provide('headlessRenderer', {});
		ctx.provide('document', {});
	}
} as Plugin;

describePlugin('export-raster', exportRaster, {
	providers: [fakeDependencies],
	contributes: ({ ctx }) => {
		expect(
			ctx.export.formats
				.listAll()
				.map((entry) => entry.id)
				.sort()
		).toEqual(['JPG', 'PNG', 'WEBP']);
	}
});
