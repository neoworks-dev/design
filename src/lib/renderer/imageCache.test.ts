import { describe, expect, it } from 'vitest';
import { decodedBytes, ImageCache, type CachedImage } from './imageCache';

class FakeImage implements CachedImage {
	deleted = false;

	constructor(
		readonly hash: string,
		private readonly side: number
	) {}

	width(): number {
		return this.side;
	}

	height(): number {
		return this.side;
	}

	delete(): void {
		if (this.deleted) throw new Error(`image ${this.hash} deleted twice`);
		this.deleted = true;
	}
}

interface Harness {
	cache: ImageCache<FakeImage>;
	decoded: FakeImage[];
	settled: string[];
	loads: string[];
}

function harness(
	budgetBytes: number,
	side = 64,
	present: (hash: string) => boolean = () => true
): Harness {
	const decoded: FakeImage[] = [];
	const settled: string[] = [];
	const loads: string[] = [];
	const cache = new ImageCache<FakeImage>({
		budgetBytes,
		loadBytes: (hash) => {
			loads.push(hash);
			if (!present(hash)) return Promise.resolve(null);
			return Promise.resolve(new TextEncoder().encode(hash));
		},
		decode: (bytes) => {
			const image = new FakeImage(new TextDecoder().decode(bytes), side);
			decoded.push(image);
			return Promise.resolve(image);
		},
		onSettled: (hash) => settled.push(hash)
	});
	return { cache, decoded, settled, loads };
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ImageCache', () => {
	it('returns nothing the first time, loads once, then serves the decoded image', async () => {
		const { cache, loads, settled } = harness(1e9);
		expect(cache.peek('a')).toBeUndefined();
		expect(cache.peek('a')).toBeUndefined();
		expect(cache.status('a')).toBe('loading');
		await settle();
		expect(loads).toEqual(['a']);
		expect(settled).toEqual(['a']);
		expect(cache.peek('a')?.width()).toBe(64);
		expect(cache.status('a')).toBe('ready');
	});

	it('stays under budget in a stress test and deletes every evicted image exactly once', async () => {
		const side = 64;
		const budget = decodedBytes(side, side) * 5;
		const { cache, decoded } = harness(budget, side);
		for (let round = 0; round < 400; round += 1) {
			cache.peek(`image-${(round * 7) % 37}`);
			await settle();
			expect(cache.usedBytes).toBeLessThanOrEqual(budget);
		}
		const alive = decoded.filter((image) => !image.deleted);
		expect(alive.length).toBe(cache.size);
		expect(cache.size).toBeLessThanOrEqual(5);
		expect(cache.evictions).toBeGreaterThan(0);
		expect(decoded.length - alive.length).toBe(cache.evictions);
	});

	it('evicts the least recently used image first', async () => {
		const side = 64;
		const { cache } = harness(decodedBytes(side, side) * 2, side);
		cache.peek('a');
		await settle();
		cache.peek('b');
		await settle();
		cache.peek('a');
		cache.peek('c');
		await settle();
		expect(cache.status('a')).toBe('ready');
		expect(cache.status('b')).toBe('loading');
		expect(cache.status('c')).toBe('ready');
	});

	it('keeps a single image larger than the budget and evicts everything else', async () => {
		const { cache } = harness(10);
		cache.peek('big');
		await settle();
		expect(cache.size).toBe(1);
		cache.peek('other');
		await settle();
		expect(cache.size).toBe(1);
		expect(cache.status('other')).toBe('ready');
	});

	it('marks hashes without bytes as missing and does not retry them until invalidated', async () => {
		const { cache, loads, settled } = harness(1e9, 64, (hash) => hash !== 'gone');
		cache.peek('gone');
		await settle();
		expect(cache.status('gone')).toBe('missing');
		expect(settled).toEqual(['gone']);
		cache.peek('gone');
		await settle();
		expect(loads).toEqual(['gone']);
		cache.invalidate('gone');
		cache.peek('gone');
		await settle();
		expect(loads).toEqual(['gone', 'gone']);
	});

	it('marks undecodable bytes as missing', async () => {
		const settled: string[] = [];
		const cache = new ImageCache<FakeImage>({
			budgetBytes: 1e9,
			loadBytes: () => Promise.resolve(new Uint8Array([1])),
			decode: () => Promise.resolve(null),
			onSettled: (hash) => settled.push(hash)
		});
		cache.peek('x');
		await settle();
		expect(cache.status('x')).toBe('missing');
		expect(settled).toEqual(['x']);
	});

	it('treats a failing loader as missing instead of throwing', async () => {
		const settled: string[] = [];
		const cache = new ImageCache<FakeImage>({
			budgetBytes: 1e9,
			loadBytes: () => Promise.reject(new Error('disk')),
			decode: () => Promise.resolve(null),
			onSettled: (hash) => settled.push(hash)
		});
		cache.peek('x');
		await settle();
		expect(cache.status('x')).toBe('missing');
		expect(settled).toEqual(['x']);
	});

	it('invalidate and dispose delete decoded images; a decode finishing after dispose is deleted', async () => {
		const { cache, decoded } = harness(1e9);
		cache.peek('a');
		await settle();
		cache.invalidate('a');
		expect(decoded[0].deleted).toBe(true);
		expect(cache.usedBytes).toBe(0);
		cache.peek('b');
		cache.dispose();
		await settle();
		expect(decoded.every((image) => image.deleted)).toBe(true);
		expect(cache.size).toBe(0);
	});
});
