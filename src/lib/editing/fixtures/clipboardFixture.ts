// Providers for the clipboard tests: the editing providers plus a desktop service on the in-memory
// browser bridge (whose clipboard the tests read and set), and small stand-ins for the blobs and
// viewport services, which need the renderer and a file in the real app.

import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import type { BrowserBridge } from '../../desktop/browserBridge';
import { createBrowserBridge } from '../../desktop/browserBridge';
import type { AssetRecord, Rect } from '../../document';
import desktopBridge from '../../../plugins/desktop-bridge';
import { editingProviders } from './editingFixture';

export interface ClipboardTestWorld {
	bridge: BrowserBridge;
	providers: Plugin[];
	/** What the viewport stand-in reports as the visible world rectangle. */
	viewport: { rect: Rect };
}

export const TEST_IMAGE_SIZE = { width: 40, height: 20 };

class StubBlobs extends Service {
	constructor(ctx: Context) {
		super(ctx, 'blobs');
	}

	put(bytes: Uint8Array): Promise<unknown> {
		const record: AssetRecord = {
			id: `hash-${bytes.length}`,
			mime: 'image/png',
			...TEST_IMAGE_SIZE
		};
		return Promise.resolve({
			hash: record.id,
			record,
			created: true,
			changes: [{ t: 'entity-add', kind: 'asset', entity: record }],
			oversized: false,
			info: { mime: 'image/png', ...TEST_IMAGE_SIZE }
		});
	}
}

class StubViewport extends Service {
	constructor(
		ctx: Context,
		private readonly view: { rect: Rect }
	) {
		super(ctx, 'viewport');
	}

	get size(): { width: number; height: number } {
		return { width: this.view.rect.width, height: this.view.rect.height };
	}

	get zoom(): number {
		return 1;
	}

	visibleRect(): Rect {
		return this.view.rect;
	}

	panBy(): void {}

	zoomToRect(): boolean {
		return true;
	}
}

export function clipboardWorld(): ClipboardTestWorld {
	const bridge = createBrowserBridge();
	const viewport = { rect: { x: 1000, y: 1000, width: 800, height: 600 } };
	const providers: Plugin[] = [
		...editingProviders(),
		{ ...desktopBridge, apply: (ctx: Context) => desktopBridge.apply(ctx, { bridge }) },
		{
			name: 'blobs',
			inject: [],
			apply: (ctx: Context): void => {
				new StubBlobs(ctx);
			}
		},
		{
			name: 'viewport',
			inject: [],
			apply: (ctx: Context): void => {
				new StubViewport(ctx, viewport);
			}
		}
	];
	return { bridge, providers, viewport };
}
