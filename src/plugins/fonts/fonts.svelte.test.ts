import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, FontRef } from '../../../electron/bridge';
import { describePlugin, mountPlugin } from '../../lib/kernel/testing';
import desktopBridge from '../desktop-bridge';
import fontsPlugin from './index';
import type { FontSink } from './fonts';

const require = createRequire(import.meta.url);
const GEIST_WOFF = new Uint8Array(
	readFileSync(require.resolve('@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff'))
);

const INSTALLED: FontRef[] = [
	{ family: 'Inter', style: 'Regular' },
	{ family: 'Inter', style: 'Bold' }
];
const INTER_BYTES = new Uint8Array([9, 8, 7, 6]);

function fontsBridge(overrides: Partial<DesktopBridge['fonts']> = {}): Partial<DesktopBridge> {
	return {
		fonts: {
			list: vi.fn(() => Promise.resolve(INSTALLED)),
			load: vi.fn((ref: FontRef) =>
				Promise.resolve(ref.family === 'Inter' && ref.style === 'Bold' ? INTER_BYTES : null)
			),
			...overrides
		}
	};
}

const fetchBytes = vi.fn(() =>
	Promise.resolve(
		GEIST_WOFF.buffer.slice(GEIST_WOFF.byteOffset, GEIST_WOFF.byteOffset + GEIST_WOFF.byteLength)
	)
);

async function mountFonts(
	bridge: Partial<DesktopBridge> = fontsBridge()
): Promise<Awaited<ReturnType<typeof mountPlugin>>> {
	fetchBytes.mockClear();
	return mountPlugin(fontsPlugin, {
		providers: [desktopBridge],
		desktop: bridge,
		config: { fetchBytes }
	});
}

describePlugin('fonts', fontsPlugin, {
	providers: [desktopBridge],
	desktop: fontsBridge(),
	config: { fetchBytes },
	contributes: ({ ctx }) => {
		expect(ctx.fonts.faces().length).toBeGreaterThan(0);
		expect(ctx.fonts.families()).toContain('Geist');
	}
});

describe('fonts service', () => {
	it('lists installed fonts next to the bundled ones and announces the change', async () => {
		const mounted = await mountFonts();
		const { fonts } = mounted.ctx;
		expect(fonts.ready).toBe(true);
		expect(fonts.families()).toEqual(['Geist', 'Geist Mono', 'Inter']);
		expect(fonts.faces().filter((face) => face.source === 'system')).toHaveLength(2);
		await mounted.cleanup();
	});

	it('does not flag anything missing before the list arrives, then flags unknown fonts', async () => {
		let release: (refs: FontRef[]) => void = () => {};
		const pending = new Promise<FontRef[]>((resolve) => (release = resolve));
		const mounted = await mountFonts(fontsBridge({ list: () => pending }));
		const { fonts } = mounted.ctx;
		expect(fonts.ready).toBe(false);
		expect(fonts.isMissing({ family: 'Inter', style: 'Regular' })).toBe(false);

		release(INSTALLED);
		await vi.waitFor(() => expect(fonts.ready).toBe(true));
		expect(fonts.isMissing({ family: 'Inter', style: 'Regular' })).toBe(false);
		expect(fonts.isMissing({ family: 'Papyrus', style: 'Regular' })).toBe(true);
		expect(fonts.isMissing({ family: 'Geist', style: 'Bold' })).toBe(false);
		await mounted.cleanup();
	});

	it('exposes the panel flag: the distinct missing references among a node runs', async () => {
		const mounted = await mountFonts();
		const { fonts } = mounted.ctx;
		const runs: FontRef[] = [
			{ family: 'Inter', style: 'Bold' },
			{ family: 'Papyrus', style: 'Regular' },
			{ family: 'papyrus', style: 'regular' },
			{ family: 'Inter', style: 'Black' }
		];
		expect(fonts.hasMissingFont(runs)).toBe(true);
		expect(fonts.missingFonts(runs)).toEqual([
			{ family: 'Papyrus', style: 'Regular' },
			{ family: 'Inter', style: 'Black' }
		]);
		expect(fonts.hasMissingFont([runs[0]])).toBe(false);
		await mounted.cleanup();
	});

	it('loads an installed font through the desktop bridge, once', async () => {
		const load = vi.fn((ref: FontRef) =>
			Promise.resolve(ref.style === 'Bold' ? INTER_BYTES : null)
		);
		const mounted = await mountFonts(fontsBridge({ load }));
		const first = await mounted.ctx.fonts.load({ family: 'Inter', style: 'Bold' });
		const second = await mounted.ctx.fonts.load({ family: 'inter', style: 'bold' });
		expect(first.missing).toBe(false);
		expect(first.face).toMatchObject({ family: 'Inter', style: 'Bold', source: 'system' });
		expect(new Uint8Array(first.bytes)).toEqual(INTER_BYTES);
		expect(second.bytes).toBe(first.bytes);
		expect(load).toHaveBeenCalledTimes(1);
		await mounted.cleanup();
	});

	it('an unknown font falls back to bundled Geist as sfnt bytes, without throwing', async () => {
		const mounted = await mountFonts();
		const loaded = await mounted.ctx.fonts.load({ family: 'Papyrus', style: 'Bold' });
		expect(loaded.missing).toBe(true);
		expect(loaded.face).toMatchObject({ family: 'Geist', style: 'Bold', source: 'bundled' });
		const tag = new DataView(loaded.bytes).getUint32(0);
		expect([0x00010000, 0x4f54544f]).toContain(tag);
		await mounted.cleanup();
	});

	it('falls back when an installed font cannot be read', async () => {
		const mounted = await mountFonts(
			fontsBridge({ load: () => Promise.reject(new Error('HANDLER_FAILED: gone')) })
		);
		const loaded = await mounted.ctx.fonts.load({ family: 'Inter', style: 'Regular' });
		expect(loaded).toMatchObject({ missing: true, face: { source: 'bundled' } });
		await mounted.cleanup();
	});

	it('keeps working when listing fails: bundled fonts only, nothing flagged', async () => {
		const mounted = await mountFonts(
			fontsBridge({ list: () => Promise.reject(new Error('HANDLER_FAILED: no')) })
		);
		const { fonts } = mounted.ctx;
		expect(fonts.ready).toBe(false);
		expect(fonts.isMissing({ family: 'Inter', style: 'Regular' })).toBe(false);
		expect((await fonts.load({ family: 'Inter', style: 'Regular' })).missing).toBe(true);
		await mounted.cleanup();
	});

	it('embedded fonts win over installed ones and unregister cleanly', async () => {
		const mounted = await mountFonts();
		const { fonts } = mounted.ctx;
		const embedded = new Uint8Array([1, 1, 1]).buffer;
		const remove = fonts.embed({ family: 'Inter', style: 'Bold' }, embedded);
		const loaded = await fonts.load({ family: 'Inter', style: 'Bold' });
		expect(loaded.face.source).toBe('embedded');
		expect(loaded.bytes).toBe(embedded);
		expect(fonts.isMissing({ family: 'Embedded Only', style: 'Regular' })).toBe(true);

		await remove();
		expect((await fonts.load({ family: 'Inter', style: 'Bold' })).face.source).toBe('system');
		await mounted.cleanup();
	});

	it('hands loaded faces to attached sinks, replays earlier ones, and detaches on dispose', async () => {
		const mounted = await mountFonts();
		const { fonts } = mounted.ctx;
		await fonts.load({ family: 'Inter', style: 'Bold' });

		const received: string[] = [];
		const sink: FontSink = {
			registerFont: (face) => received.push(`${face.family}/${face.style}`)
		};
		const detach = fonts.attach(sink);
		await vi.waitFor(() => expect(received).toEqual(['Inter/Bold']));

		await fonts.load({ family: 'Inter', style: 'Regular' });
		expect(received).toContain('Geist/Regular');

		await detach();
		const before = received.length;
		await fonts.load({ family: 'Geist', style: 'Bold' });
		expect(received).toHaveLength(before);
		await mounted.cleanup();
	});

	it('a sink attached by a consumer plugin is detached when that plugin unmounts', async () => {
		const mounted = await mountFonts();
		const { fonts } = mounted.ctx;
		const received: string[] = [];
		const consumer = await mounted.ctx.plugin({
			name: 'font-consumer',
			inject: ['fonts'],
			apply(ctx) {
				ctx.fonts.attach({ registerFont: (face) => received.push(face.family) });
			}
		});
		await fonts.load({ family: 'Geist', style: 'Regular' });
		expect(received).toEqual(['Geist']);
		expect(fonts.snapshotState()).toMatchObject({ sinks: 1 });

		await consumer.dispose();
		expect(fonts.snapshotState()).toMatchObject({ sinks: 0 });
		await mounted.assertUnmountsClean();
	});
});
