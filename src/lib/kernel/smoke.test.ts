import { Context } from '@neoworks/extension-system';
import { describe, expect, it } from 'vitest';

describe('test runner', () => {
	it('loads the linked kernel package', () => {
		expect(new Context()).toBeInstanceOf(Context);
	});
});
