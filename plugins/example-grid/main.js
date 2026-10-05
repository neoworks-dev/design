// Grid Maker: an example third-party plugin. It runs in its own Web Worker and only sees the
// `design` object. Everything one command changes is a single undo step.

const settings = { columns: 4, rows: 3, size: 48, gap: 12 };

function cellColor(row, column) {
	const hue = ((row * settings.columns + column) * 28) % 360;
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
	const { columns, rows, size, gap } = settings;
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

await design.commands.register('example-grid.make-grid', makeGrid);
await design.commands.register('example-grid.clear-grids', clearGrids);
