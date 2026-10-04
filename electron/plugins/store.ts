// main-store: the `store` service and the `store:*` IPC routes. Each window has at most one open
// design file; its handle lives as long as the effect that opened it, so closing the window,
// opening another file, or unloading the plugin closes (and checkpoints) the database.

import { Service, type Context, type Plugin } from '@neoworks/extension-system';
import type { DesignDocument, Transaction } from '../../src/lib/document/types';
import type { CommitResult, LoadedDocument, StoreInfo } from '../bridge';
import { route } from '../kernel/route';
import type { SenderHandle } from '../kernel/host';
import { DocumentFile } from '../store/documentFile';
import { StoreError } from '../store/errors';
import { isUntitledPath } from '../store/untitled';

interface OpenStore {
	file: DocumentFile;
	/** Reverts the effect that opened it: closes the file and detaches the window listener. */
	release: () => Promise<void>;
}

export class StoreService extends Service {
	private readonly stores = new Map<number, OpenStore>();

	constructor(ctx: Context) {
		super(ctx, 'store');
	}

	/** Open `path` as the sender's document, closing whatever it had open. */
	open(sender: SenderHandle, path: string): Promise<StoreInfo> {
		return this.adopt(sender, () => DocumentFile.open(path));
	}

	/** Create a new file at `path` holding `document` (or a blank one) as the sender's document. */
	create(sender: SenderHandle, path: string, document?: DesignDocument): Promise<StoreInfo> {
		return this.adopt(sender, () => DocumentFile.create(path, document));
	}

	/**
	 * Make the file `produce` returns the sender's document and close the one it had. `produce`
	 * runs first: if it throws, the window keeps its document. Resolves once the previous file
	 * is closed, so callers may delete or replace it.
	 */
	async adopt(sender: SenderHandle, produce: () => DocumentFile): Promise<StoreInfo> {
		const file = produce();
		await this.close(sender);
		const release = this.ctx.effect(() => {
			const window = this.ctx.electron.windowFromSender(sender);
			const stopWatching =
				window === null ? () => {} : window.on('closed', () => void this.close(sender));
			return () => {
				stopWatching();
				file.close();
			};
		}, `store:file ${file.path}`);
		this.stores.set(sender.id, { file, release });
		return this.infoOf(file);
	}

	/** What `file` says about itself, plus whether it is an untitled document of ours. */
	infoOf(file: DocumentFile): StoreInfo {
		const userData = this.ctx.electron.app.getPath('userData');
		return { ...file.info(), untitled: isUntitledPath(userData, file.path) };
	}

	/** The sender's open file; throws NO_STORE when it has none. */
	current(sender: SenderHandle): DocumentFile {
		const open = this.stores.get(sender.id);
		if (!open) throw new StoreError('NO_STORE', 'this window has no document file open');
		return open.file;
	}

	hasStore(sender: SenderHandle): boolean {
		return this.stores.has(sender.id);
	}

	load(sender: SenderHandle): LoadedDocument {
		const file = this.current(sender);
		return { info: this.infoOf(file), document: file.load() };
	}

	/** Persist `transactions` in order, each as its own SQLite transaction. */
	commit(sender: SenderHandle, transactions: Transaction[]): CommitResult {
		const file = this.current(sender);
		let committed = 0;
		let documentRows = 0;
		for (const transaction of transactions) {
			const stats = file.commit(transaction);
			if (stats.duplicate) continue;
			committed += 1;
			documentRows += stats.documentRows;
		}
		return { committed, documentRows };
	}

	/** Save: checkpoint the sender's file and clear its unsaved marker. */
	checkpoint(sender: SenderHandle): StoreInfo {
		const file = this.current(sender);
		file.checkpoint();
		return this.infoOf(file);
	}

	async close(sender: SenderHandle): Promise<void> {
		const open = this.stores.get(sender.id);
		if (!open) return;
		this.stores.delete(sender.id);
		await open.release();
	}

	/** Paths of every open file, sorted: part of the observable state in tests. */
	openPaths(): string[] {
		return [...this.stores.values()].map((open) => open.file.path).sort();
	}

	snapshotState(): Record<string, unknown> {
		return { open: this.openPaths() };
	}
}

declare module '@neoworks/extension-system' {
	interface Context {
		store: StoreService;
	}
}

export const mainStorePlugin: Plugin.Object = {
	name: 'main-store',
	inject: ['electron', 'ipc'],
	apply(ctx) {
		const store = new StoreService(ctx);

		route(ctx, 'store:open', (request, event) => store.open(event.sender, request.path));
		route(ctx, 'store:create', (request, event) =>
			store.create(event.sender, request.path, request.document)
		);
		route(ctx, 'store:load', (_payload, event) => store.load(event.sender));
		route(ctx, 'store:close', (_payload, event) => store.close(event.sender));
		route(ctx, 'store:commit', (request, event) =>
			store.commit(event.sender, request.transactions)
		);
		route(ctx, 'store:checkpoint', (_payload, event) => store.checkpoint(event.sender));
	}
};
