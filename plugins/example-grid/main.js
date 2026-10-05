// Grid Maker: an example third-party plugin. It runs in its own Web Worker and only sees the
// `design` object: commands, document edits through `design.document`, and a declarative panel
// (`design.ui`). Everything one command or button press changes is a single undo step.

const PANEL = 'example-grid.panel';

const state = { columns: 4, rows: 3, size: 48, gap: 12, grids: 0, selected: 0 };

function cellColor(row, column) {
	const hue = ((row * state.columns + column) * 28) % 360;
	const lightness = 0.55;
	const chroma = (1 - Math.abs(2 * lightness - 1)) * 0.7;
	const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
	const offset = lightness - chroma / 2;
	const sector = Math.floor(hue / 60);
	const [r, g, b] = [
		[chroma, x, 0],
		[x, chroma, 0],
		[0, chroma, x],
		[0, x, chroma],
		[x, 0, chroma],
		[chroma, 0, x]
	][sector];
	const hex = (value) =>
		Math.round((value + offset) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

async function makeGrid() {
	const { columns, rows, size, gap } = state;
	const operations = [
		{
			op: 'create',
			type: 'FRAME',
			ref: 'grid',
			props: {
				name: 'Grid',
				x: 120,
				y: 120,
				width: columns * size + (columns + 1) * gap,
				height: rows * size + (rows + 1) * gap,
				fill: '#222222',
				cornerRadius: 8
			}
		}
	];
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			operations.push({
				op: 'create',
				type: 'RECTANGLE',
				parentId: 'grid',
				props: {
					name: `Cell ${row + 1}-${column + 1}`,
					x: gap + column * (size + gap),
					y: gap + row * (size + gap),
					width: size,
					height: size,
					fill: cellColor(row, column),
					cornerRadius: 6
				}
			});
		}
	}
	const result = await design.document.apply(operations, { label: 'Make grid' });
	const frameId = result.created[0].id;
	await design.selection.set([frameId]);
	await design.viewport.scrollAndZoomIntoView([frameId]);
	design.log.info(`made a ${columns} x ${rows} grid`);
}

async function clearGrids() {
	const grids = await design.document.query({ type: 'FRAME', name: 'Grid' });
	if (grids.length === 0) return;
	await design.document.apply(grids.map((grid) => ({ op: 'delete', id: grid.id })));
	design.log.info(`removed ${grids.length} grid(s)`);
}

function numberField(label, key, min, max) {
	return {
		type: 'input',
		label,
		inputType: 'number',
		value: String(state[key]),
		min,
		max,
		onChange: (value) => {
			if (Number.isFinite(value)) state[key] = Math.min(max, Math.max(min, Math.round(value)));
			return render();
		}
	};
}

function view() {
	return {
		type: 'stack',
		gap: 'lg',
		children: [
			{
				type: 'section',
				title: 'Grid',
				children: [
					{
						type: 'stack',
						direction: 'row',
						children: [numberField('Columns', 'columns', 1, 12), numberField('Rows', 'rows', 1, 12)]
					},
					{
						type: 'stack',
						direction: 'row',
						children: [numberField('Cell size', 'size', 8, 200), numberField('Gap', 'gap', 0, 64)]
					}
				]
			},
			{
				type: 'button',
				label: `Make ${state.columns} x ${state.rows} grid`,
				variant: 'primary',
				full: true,
				onClick: makeGrid
			},
			{ type: 'divider' },
			{
				type: 'text',
				tone: 'muted',
				text: `${state.grids} grid(s) on this page, ${state.selected} layer(s) selected`
			},
			{
				type: 'button',
				label: 'Remove grids',
				disabled: state.grids === 0,
				onClick: clearGrids
			}
		]
	};
}

async function render() {
	await design.ui.set(PANEL, view());
}

async function refresh() {
	const grids = await design.document.query({ type: 'FRAME', name: 'Grid' });
	state.grids = grids.length;
	state.selected = (await design.selection.get()).length;
	await render();
}

await design.commands.register('example-grid.make-grid', makeGrid);
await design.commands.register('example-grid.clear-grids', clearGrids);

design.on('documentchange', refresh);
design.on('currentpagechange', refresh);
design.on('selectionchange', refresh);
await refresh();
