import { describe, expect, it } from 'vitest';
import { collapseEffortVariants } from './harnessAgents';

describe('collapseEffortVariants', () => {
	it('folds per-effort model ids into one entry and keeps plain ids', () => {
		const models = collapseEffortVariants([
			{ id: 'gpt-6-sol[low]', name: '6 Sol (low)', description: 'Workhorse model. Fast.' },
			{ id: 'gpt-6-sol[high]', name: '6 Sol (high)', description: 'Workhorse model. Deep.' },
			{ id: 'sonnet', name: 'Sonnet 5' }
		]);
		expect(models).toEqual([
			{ id: 'gpt-6-sol', name: '6 Sol', description: 'Workhorse model.' },
			{ id: 'sonnet', name: 'Sonnet 5', description: undefined }
		]);
	});
});
