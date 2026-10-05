import type { Context, Plugin } from '@neoworks/extension-system';
import { afterEach, describe, expect, it } from 'vitest';
import type {
	ArchiveEntry,
	CreateFromArchiveRequest,
	DesktopBridge
} from '../../../electron/bridge';
import { panelProviders } from '../../lib/editing/fixtures/panelHarness';
import { describePlugin, mountPlugin, type MountedPlugin } from '../../lib/kernel/testing';
import desktopBridge from '../desktop-bridge';
import fileSessionPlugin from '../file-session';
import errorUiPlugin from '../error-ui';
import archiveIo from './index';

const fileSession: Plugin.Object = {
	...fileSessionPlugin,
	apply: (ctx: Context) => fileSessionPlugin.apply(ctx, { startup: 'none', delayMs: 1 })
};

// Built per call: the document plugin edits the fixture document in place.
function providers(): Plugin[] {
	return [...panelProviders(), desktopBridge, fileSession, errorUiPlugin];
}

describePlugin('archive-io', archiveIo, {
	providers: providers(),
	desktop: true,
	contributes: ({ ctx }) => {
		expect(ctx.archive).toBeDefined();
		expect(ctx.commands.has('file.exportArchive')).toBe(true);
		expect(ctx.commands.has('file.importArchive')).toBe(true);
		const menu = ctx.menus.registry.listAll().map((entry) => entry.id);
		expect(menu.some((id) => id.includes('file.exportArchive'))).toBe(true);
	}
});

const HASH = 'cd'.repeat(32);
const IMAGE = new Uint8Array([137, 80, 78, 71, 5, 6, 7]);

let mounted: MountedPlugin | null = null;
afterEach(async () => {
	await mounted?.cleanup();
	mounted = null;
});

interface Recorded {
	exported: Array<{ name: string; entries: ArchiveEntry[] }>;
	created: CreateFromArchiveRequest[];
	opened: string[];
	toasts: string[];
}

/** The plugin over a fake main that keeps the image and zips nothing (entries pass through). */
async function open(): Promise<{ ctx: Context; recorded: Recorded }> {
	const recorded: Recorded = { exported: [], created: [], opened: [], toasts: [] };
	let lastExport: ArchiveEntry[] = [];
	const bridge: Partial<DesktopBridge> = {
		archive: {
			export: (name, entries) => {
				recorded.exported.push({ name, entries });
				lastExport = entries;
				return Promise.resolve('/tmp/out.zip');
			},
			read: () => Promise.resolve({ path: '/tmp/out.zip', entries: lastExport }),
			createFile: (request) => {
				recorded.created.push(request);
				return Promise.resolve('/tmp/imported.ndesign');
			}
		},
		store: {
			open: () => Promise.reject(new Error('not used')),
			create: () => Promise.reject(new Error('not used')),
			load: () => Promise.reject(new Error('not used')),
			close: () => Promise.resolve(),
			checkpoint: () => Promise.reject(new Error('not used')),
			commit: (transactions) => Promise.resolve({ committed: transactions.length, documentRows: 0 })
		},
		assets: {
			put: () => Promise.reject(new Error('not used')),
			get: (hash) => Promise.resolve(hash === HASH ? IMAGE : null),
			collect: () => Promise.resolve([]),
			embedFont: () => Promise.resolve(),
			fontBytes: (face) => Promise.resolve(face.family === 'Inter' ? new Uint8Array([1, 2]) : null),
			embeddedFonts: () => Promise.resolve([{ family: 'Inter', style: 'Regular' }])
		}
	};
	mounted = await mountPlugin(archiveIo, { providers: providers(), desktop: bridge });
	const { ctx } = mounted;
	ctx.fileSession.attach({
		path: '/tmp/x.ndesign',
		documentId: 'd',
		name: 'x',
		schemaVersion: 1,
		createdAt: 0,
		modifiedAt: 0,
		recovered: false,
		inLibrary: true
	});
	ctx.fileSession.openDocument = (path?: string): Promise<boolean> => {
		if (path !== undefined) recorded.opened.push(path);
		return Promise.resolve(true);
	};
	return { ctx, recorded };
}

function withAsset(ctx: Context): void {
	ctx.document.apply(
		ctx.document.addEntity('asset', { id: HASH, mime: 'image/png', width: 7, height: 1 }),
		{
			origin: 'user',
			label: 'Add asset'
		}
	);
}

describe('export', () => {
	it('sends the archive of the open document with its image and font bytes to main', async () => {
		const { ctx, recorded } = await open();
		withAsset(ctx);
		const outcome = await ctx.archive.exportArchive();
		expect(outcome).toEqual({ kind: 'info', message: 'Exported the archive to /tmp/out.zip.' });
		const [call] = recorded.exported;
		const paths = call.entries.map((entry) => entry.path);
		expect(paths).toContain('manifest.json');
		expect(paths).toContain(`assets/${HASH}.png`);
		expect(paths).toContain('fonts/0000.font');
	});

	it('is deterministic: exporting twice gives identical entries', async () => {
		const { ctx, recorded } = await open();
		await ctx.archive.exportArchive();
		await ctx.archive.exportArchive();
		const [first, second] = recorded.exported;
		expect(first.entries.map((entry) => [entry.path, [...entry.bytes]])).toEqual(
			second.entries.map((entry) => [entry.path, [...entry.bytes]])
		);
	});

	it('the command reports its outcome as an error UI toast', async () => {
		const { ctx } = await open();
		await ctx.commands.run('file.exportArchive');
		expect(ctx.errorUi.toasts[0].message).toContain('Exported the archive');
	});
});

describe('import', () => {
	it('round trips: the document, image and font arrive in the file main creates and it is opened', async () => {
		const { ctx, recorded } = await open();
		withAsset(ctx);
		const before = JSON.parse(JSON.stringify(ctx.document.snapshot));
		await ctx.archive.exportArchive();
		const outcome = await ctx.archive.importArchive();

		expect(outcome.kind).toBe('info');
		expect(outcome.message).toContain('/tmp/imported.ndesign');
		const [request] = recorded.created;
		expect(request.document).toEqual(before);
		expect(request.images).toHaveLength(1);
		expect([...request.images[0].bytes]).toEqual([...IMAGE]);
		expect(request.fonts).toMatchObject([{ family: 'Inter', style: 'Regular' }]);
		expect(recorded.opened).toEqual(['/tmp/imported.ndesign']);
	});

	it('never touches the open document', async () => {
		const { ctx } = await open();
		const revision = ctx.document.revision;
		await ctx.archive.exportArchive();
		await ctx.archive.importArchive();
		expect(ctx.document.revision).toBe(revision);
	});

	it('explains an archive it cannot read and creates nothing', async () => {
		const { ctx, recorded } = await open();
		await ctx.archive.exportArchive();
		recorded.exported[0].entries = recorded.exported[0].entries.filter(
			(entry) => entry.path !== 'manifest.json'
		);
		const bridge = mounted?.desktop?.bridge;
		if (bridge) {
			bridge.archive.read = (): ReturnType<DesktopBridge['archive']['read']> =>
				Promise.resolve({ path: '/tmp/x.zip', entries: recorded.exported[0].entries });
		}
		const outcome = await ctx.archive.importArchive();
		expect(outcome.kind).toBe('error');
		expect(outcome.message).toContain('no manifest.json');
		expect(recorded.created).toEqual([]);
		expect(recorded.opened).toEqual([]);
	});
});
