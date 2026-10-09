// `window.__interactionLab` for Figma, built on the plugin API (the `figma` global that Figma
// exposes in the page). Runs in the page, so it is a plain string. Same contract as appPage.ts.

export const FIGMA_PAGE_HELPERS = `(() => {
	const LAB_PAGE = 'CDP lab';

	function canvasElement() {
		let largest = null;
		let largestArea = 0;
		for (const canvas of document.querySelectorAll('canvas')) {
			const rect = canvas.getBoundingClientRect();
			const area = rect.width * rect.height;
			if (area <= largestArea) continue;
			largest = canvas;
			largestArea = area;
		}
		if (!largest) throw new Error('no canvas in the Figma tab');
		return largest;
	}

	function canvasRect() {
		const rect = canvasElement().getBoundingClientRect();
		return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
	}

	function toClient(point) {
		const rect = canvasRect();
		const bounds = figma.viewport.bounds;
		const zoom = figma.viewport.zoom;
		return { x: rect.x + (point.x - bounds.x) * zoom, y: rect.y + (point.y - bounds.y) * zoom };
	}

	function toCanvas(point) {
		const rect = canvasRect();
		const bounds = figma.viewport.bounds;
		const zoom = figma.viewport.zoom;
		return { x: bounds.x + (point.x - rect.x) / zoom, y: bounds.y + (point.y - rect.y) / zoom };
	}

	function describe(node) {
		const parent = node.parent;
		const description = {
			id: node.id, name: node.name, type: node.type,
			x: node.x, y: node.y, width: node.width, height: node.height,
			absolute: node.absoluteBoundingBox, parent: null, index: -1
		};
		if (parent) {
			description.parent = { id: parent.id, name: parent.name, type: parent.type };
			description.index = parent.children.indexOf(node);
		}
		return description;
	}

	function findNode(name) {
		const node = figma.currentPage.findOne((candidate) => candidate.name === name);
		if (!node) throw new Error('no node named "' + name + '" on the current page');
		return node;
	}

	const ANCHORS = {
		center: [0.5, 0.5], tl: [0, 0], t: [0.5, 0], tr: [1, 0], l: [0, 0.5],
		r: [1, 0.5], bl: [0, 1], b: [0.5, 1], br: [1, 1]
	};

	function nodePoint(name, anchor) {
		const box = findNode(name).absoluteBoundingBox;
		const factors = ANCHORS[anchor];
		if (!factors) throw new Error('unknown anchor "' + anchor + '"');
		return toClient({ x: box.x + box.width * factors[0], y: box.y + box.height * factors[1] });
	}

	function sample() {
		return { selection: figma.currentPage.selection.map(describe) };
	}

	function pageChildren() {
		return figma.currentPage.children.map((node) => node.type + ' "' + node.name + '"');
	}

	function viewportKey() {
		return JSON.stringify(figma.viewport.bounds);
	}

	function setViewport(zoom, center) {
		figma.viewport.zoom = zoom;
		figma.viewport.center = center;
	}

	function select(names) {
		figma.currentPage.selection = names.map(findNode);
	}

	function placeNode(name, x, y) {
		const node = findNode(name);
		node.x = x;
		node.y = y;
	}

	function solid(red, green, blue) {
		return [{ type: 'SOLID', color: { r: red, g: green, b: blue } }];
	}

	function rectangle(name, x, y, width, height, fills, parent) {
		const node = figma.createRectangle();
		node.name = name;
		node.resize(width, height);
		node.fills = fills;
		parent.appendChild(node);
		node.x = x;
		node.y = y;
		return node;
	}

	// Two loose rectangles, a plain frame with two children and a horizontal auto-layout frame, all
	// on whole pixels. Keep in sync with appPage.ts.
	function addFixture() {
		const page = figma.currentPage;
		rectangle('A', 0, 0, 100, 100, solid(0.95, 0.3, 0.3), page);
		rectangle('B', 300, 0, 100, 100, solid(0.3, 0.5, 0.95), page);

		const frame = figma.createFrame();
		frame.name = 'Frame';
		frame.resize(400, 300);
		page.appendChild(frame);
		frame.x = 0;
		frame.y = 300;
		rectangle('C', 40, 40, 80, 80, solid(0.3, 0.8, 0.4), frame);
		rectangle('D', 240, 40, 80, 80, solid(0.95, 0.7, 0.2), frame);

		const stack = figma.createFrame();
		stack.name = 'Stack';
		stack.layoutMode = 'HORIZONTAL';
		stack.itemSpacing = 10;
		stack.paddingLeft = 10;
		stack.paddingRight = 10;
		stack.paddingTop = 10;
		stack.paddingBottom = 10;
		stack.primaryAxisSizingMode = 'AUTO';
		stack.counterAxisSizingMode = 'AUTO';
		page.appendChild(stack);
		stack.x = 500;
		stack.y = 300;
		for (const name of ['S1', 'S2', 'S3']) rectangle(name, 0, 0, 60, 60, solid(0.6, 0.4, 0.9), stack);
	}

	// Scene spec nodes: { type: frame|rectangle|text|component|group, name, x, y, width, height,
	// rotation?, children? }. Children of a frame or component are relative to it; the members of a
	// group are given in the group's parent space and the group is fitted to them.
	const SCENE_FILLS = {
		frame: solid(0.85, 0.85, 0.9), rectangle: solid(0.95, 0.3, 0.3), text: solid(0.1, 0.1, 0.1),
		component: solid(0.7, 0.9, 0.7)
	};

	function createSceneNode(spec, parent) {
		if (spec.type === 'group') return createSceneGroup(spec, parent);
		let node;
		if (spec.type === 'frame') node = figma.createFrame();
		else if (spec.type === 'component') node = figma.createComponent();
		else if (spec.type === 'rectangle') node = figma.createRectangle();
		else if (spec.type === 'text') {
			node = figma.createText();
			node.fontName = { family: 'Inter', style: 'Regular' };
			node.characters = 'Text';
			node.textAutoResize = 'NONE';
		} else throw new Error('unknown scene node type "' + spec.type + '"');
		node.name = spec.name;
		node.resize(spec.width, spec.height);
		node.fills = SCENE_FILLS[spec.type];
		parent.appendChild(node);
		node.x = spec.x;
		node.y = spec.y;
		if (spec.rotation) node.rotation = spec.rotation;
		for (const child of spec.children || []) createSceneNode(child, node);
		return node;
	}

	function createSceneGroup(spec, parent) {
		const members = (spec.children || []).map((child) => createSceneNode(child, parent));
		const group = figma.group(members, parent);
		group.name = spec.name;
		return group;
	}

	async function buildScene(specs) {
		await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
		for (const spec of specs) createSceneNode(spec, figma.currentPage);
	}

	async function resetLab(scene) {
		let page = figma.root.children.find((candidate) => candidate.name === LAB_PAGE);
		if (!page) {
			page = figma.createPage();
			page.name = LAB_PAGE;
		}
		await figma.setCurrentPageAsync(page);
		for (const node of [...page.children]) node.remove();
		if (scene) await buildScene(scene);
		else addFixture();
		setViewport(1, { x: 400, y: 300 });
		figma.currentPage.selection = [];
		figma.commitUndo();
	}

	const SCRATCH_PAGE = 'CDP lab 2';

	// A second page for experiments that cross pages; closeScratchPage removes it again.
	async function openScratchPage(scene) {
		let page = figma.root.children.find((candidate) => candidate.name === SCRATCH_PAGE);
		if (!page) {
			page = figma.createPage();
			page.name = SCRATCH_PAGE;
		}
		await figma.setCurrentPageAsync(page);
		for (const node of [...page.children]) node.remove();
		await buildScene(scene);
		setViewport(1, { x: 400, y: 300 });
		figma.currentPage.selection = [];
		figma.commitUndo();
	}

	async function closeScratchPage() {
		const page = figma.root.children.find((candidate) => candidate.name === SCRATCH_PAGE);
		const lab = figma.root.children.find((candidate) => candidate.name === LAB_PAGE);
		if (lab) await figma.setCurrentPageAsync(lab);
		if (page) page.remove();
		figma.commitUndo();
	}

	const PERF_PAGE = 'CDP perf';

	// count squares of 8 px on a 10 px pitch inside one frame, the frame fitted into the viewport.
	async function buildPerfScene(count, columns) {
		const started = performance.now();
		let page = figma.root.children.find((candidate) => candidate.name === PERF_PAGE);
		if (!page) {
			page = figma.createPage();
			page.name = PERF_PAGE;
		}
		await figma.setCurrentPageAsync(page);
		for (const node of [...page.children]) node.remove();
		const rows = Math.ceil(count / columns);
		const grid = figma.createFrame();
		grid.name = 'Perf grid';
		grid.resize(columns * 10 + 10, rows * 10 + 10);
		page.appendChild(grid);
		const fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.5, b: 0.95 } }];
		for (let index = 0; index < count; index += 1) {
			const square = figma.createRectangle();
			square.name = 'P' + index;
			square.resize(8, 8);
			square.fills = fills;
			grid.appendChild(square);
			square.x = 10 + (index % columns) * 10;
			square.y = 10 + Math.floor(index / columns) * 10;
		}
		figma.viewport.scrollAndZoomIntoView([grid]);
		figma.currentPage.selection = [];
		figma.commitUndo();
		return { ms: performance.now() - started, zoom: figma.viewport.zoom };
	}

	function selectionCount() {
		return figma.currentPage.selection.length;
	}

	// Empties and removes the perf page so 50k nodes never stay in the file.
	async function clearPerfScene() {
		const page = figma.root.children.find((candidate) => candidate.name === PERF_PAGE);
		if (!page) return;
		const lab = figma.root.children.find((candidate) => candidate.name === LAB_PAGE);
		if (lab) await figma.setCurrentPageAsync(lab);
		page.remove();
		figma.commitUndo();
	}

	// Plugin edits join Figma's undo stack; this closes the current entry so the next user action
	// starts a new one.
	function commitUndo() {
		figma.commitUndo();
	}

	// The plugin API has no view of the undo stack.
	function undoDepth() {
		return null;
	}

	// Every node on the lab page with its absolute box, parent by name, in document order.
	function listNodes() {
		return figma.currentPage.findAll().map((node) => {
			const box = node.absoluteBoundingBox;
			return {
				id: node.id, name: node.name, type: node.type,
				parent: node.parent.type === 'PAGE' ? 'PAGE' : node.parent.name,
				x: box ? box.x : null, y: box ? box.y : null,
				width: box ? box.width : null, height: box ? box.height : null
			};
		});
	}

	function viewportInfo() {
		return { zoom: figma.viewport.zoom, bounds: figma.viewport.bounds };
	}

	// Finds a visible menu entry by its text and returns where to click it, or null.
	function findMenuItem(label) {
		const matches = [];
		for (const element of document.querySelectorAll('*')) {
			if (element.children.length > 0) continue;
			if ((element.textContent || '').trim() !== label) continue;
			const rect = element.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) continue;
			matches.push({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
		}
		return matches.length > 0 ? matches[matches.length - 1] : null;
	}

	function state() {
		return {
			target: 'figma', file: figma.root.name, page: figma.currentPage.name,
			viewport: { center: figma.viewport.center, zoom: figma.viewport.zoom, bounds: figma.viewport.bounds },
			canvasRect: canvasRect(), devicePixelRatio: window.devicePixelRatio,
			selection: figma.currentPage.selection.map(describe), pageChildren: pageChildren()
		};
	}

	window.__interactionLab = {
		canvasRect, toClient, toCanvas, describe: (name) => describe(findNode(name)), nodePoint,
		sample, pageChildren, viewportKey, setViewport, select, placeNode, resetLab, commitUndo,
		undoDepth, state, buildPerfScene, selectionCount, clearPerfScene, listNodes, viewportInfo,
		findMenuItem, openScratchPage, closeScratchPage
	};
	return 'installed';
})()`;

export const FIGMA_READY = 'typeof figma === "object"';
