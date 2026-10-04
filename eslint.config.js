import neoworks from '@neoworks/lint-config/eslint';

export default [
	{ ignores: ['build/', '.svelte-kit/', 'electron/dist/', 'docs/', '.qa/', '.claude/'] },
	...neoworks
];
