// A plugin written in TypeScript against @neoworks/plugin-typings: the `design` global is typed.
export {};

await design.commands.register('hello.run', async () => {
	const selection = await design.selection.nodes();
	design.log.info(`${selection.length} layers selected`);
	await design.storage.clientStorage.set('lastCount', selection.length);
	for (const node of selection) {
		await design.storage.setData(node.id, 'greeted', 'yes');
	}
});

design.on('selectionchange', (payload) => design.log.info('selection changed', payload));

await design.ui.set('hello.panel', {
	type: 'stack',
	children: [
		{ type: 'text', text: 'Hello' },
		{
			type: 'button',
			label: 'Create a rectangle',
			onClick: async () => {
				await design.document.createNode('RECTANGLE', { name: 'Hello', width: 80, height: 80 });
			}
		}
	]
});
