// `window.__interactionLab` for our app, built on the debug surface (`window.__design_debug`):
// the document, selection, viewport and history services plus its pure node builders. Runs in
// the renderer, so it is a plain string. Same contract as figmaPage.ts.

export const APP_PAGE_HELPERS = `(() => {
	const LAB_PAGE = 'CDP lab';
	const debug = window.__design_debug;
	const services = () => ({
		document: debug.document, selection: debug.selection, viewport: debug.viewport,
		history: debug.history, commands: debug.commands
	});

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
		if (!largest) throw new Error('no canvas in the app (is a file open?)');
		return largest;
	}

	function canvasRect() {
		const rect = canvasElement().getBoundingClientRect();
		return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
	}

	function toClient(point) {
		const rect = canvasRect();
		const screen = services().viewport.worldToScreen(point);
		return { x: rect.x + screen.x, y: rect.y + screen.y };
	}

	function toCanvas(point) {
		const rect = canvasRect();
		return services().viewport.screenToWorld({ x: point.x - rect.x, y: point.y - rect.y });
	}

	function describe(node) {
		const { document } = services();
		const parent = document.get(node.parentId);
		const description = {
			id: node.id, name: node.name, type: node.type,
			x: node.transform[0][2], y: node.transform[1][2], width: node.width, height: node.height,
			absolute: document.absoluteBounds(node.id), parent: null, index: -1
		};
		if (parent) {
			description.parent = { id: parent.id, name: parent.name, type: parent.type };
			description.index = document.children(parent.id).indexOf(node.id);
		}
		return description;
	}

	function findNode(name) {
		const { document } = services();
		const found = document.query((node) => node.name === name, document.currentPageId);
		const node = found.find((candidate) => candidate.type !== 'PAGE');
		if (!node) throw new Error('no node named "' + name + '" on the current page');
		return node;
	}

	const ANCHORS = {
		center: [0.5, 0.5], tl: [0, 0], t: [0.5, 0], tr: [1, 0], l: [0, 0.5],
		r: [1, 0.5], bl: [0, 1], b: [0.5, 1], br: [1, 1]
	};

	function nodePoint(name, anchor) {
		const box = services().document.absoluteBounds(findNode(name).id);
		const factors = ANCHORS[anchor];
		if (!factors) throw new Error('unknown anchor "' + anchor + '"');
		return toClient({ x: box.x + box.width * factors[0], y: box.y + box.height * factors[1] });
	}

	function sample() {
		return { selection: services().selection.nodes().map(describe) };
	}

	function pageChildren() {
		const { document } = services();
		return document.childNodes(document.currentPageId).map((node) => node.type + ' "' + node.name + '"');
	}

	function viewportKey() {
		const camera = services().viewport.camera;
		return JSON.stringify(camera);
	}

	// Camera: screen = world * scale + camera offset, in canvas CSS pixels.
	function setViewport(zoom, center) {
		const { viewport } = services();
		viewport.zoomTo(zoom);
		const size = viewport.size;
		const camera = viewport.camera;
		viewport.panBy(size.width / 2 - center.x * zoom - camera.x, size.height / 2 - center.y * zoom - camera.y);
	}

	function select(names) {
		services().selection.select(names.map((name) => findNode(name).id));
	}

	const META = { origin: 'user', label: 'interaction lab setup' };

	function placeNode(name, x, y) {
		const { document } = services();
		const node = findNode(name);
		const transform = [[...node.transform[0]], [...node.transform[1]]];
		transform[0][2] = x;
		transform[1][2] = y;
		document.apply(document.setProps(node.id, { transform }), META);
	}

	function solid(red, green, blue) {
		return [{ type: 'SOLID', color: { r: red, g: green, b: blue }, opacity: 1, visible: true, blendMode: 'NORMAL' }];
	}

	function at(x, y) {
		return [[1, 0, x], [0, 1, y]];
	}

	// Same scene as figmaPage.ts addFixture: A, B, Frame > C, D, Stack > S1..S3.
	function buildFixture(pageId) {
		const create = debug.nodes.create;
		const keys = debug.nodes.orderKeys(4);
		const stackKeys = debug.nodes.orderKeys(3);
		const nodes = [];
		const add = (node) => { nodes.push(node); return node; };
		add(create('RECTANGLE', { name: 'A', parentId: pageId, index: keys[0], transform: at(0, 0), width: 100, height: 100, fills: solid(0.95, 0.3, 0.3) }));
		add(create('RECTANGLE', { name: 'B', parentId: pageId, index: keys[1], transform: at(300, 0), width: 100, height: 100, fills: solid(0.3, 0.5, 0.95) }));
		const frame = add(create('FRAME', { name: 'Frame', parentId: pageId, index: keys[2], transform: at(0, 300), width: 400, height: 300 }));
		add(create('RECTANGLE', { name: 'C', parentId: frame.id, index: keys[0], transform: at(40, 40), width: 80, height: 80, fills: solid(0.3, 0.8, 0.4) }));
		add(create('RECTANGLE', { name: 'D', parentId: frame.id, index: keys[1], transform: at(240, 40), width: 80, height: 80, fills: solid(0.95, 0.7, 0.2) }));
		const stack = add(create('FRAME', {
			name: 'Stack', parentId: pageId, index: keys[3], transform: at(500, 300), width: 220, height: 80,
			layoutMode: 'HORIZONTAL', itemSpacing: 10, paddingTop: 10, paddingRight: 10, paddingBottom: 10,
			paddingLeft: 10, primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO'
		}));
		['S1', 'S2', 'S3'].forEach((name, position) => {
			add(create('RECTANGLE', { name, parentId: stack.id, index: stackKeys[position], transform: at(10 + position * 70, 10), width: 60, height: 60, fills: solid(0.6, 0.4, 0.9) }));
		});
		return nodes;
	}

	const SCENE_FILLS = {
		FRAME: solid(0.85, 0.85, 0.9), RECTANGLE: solid(0.95, 0.3, 0.3), TEXT: solid(0.1, 0.1, 0.1),
		COMPONENT: solid(0.7, 0.9, 0.7)
	};
	const SCENE_TYPES = { frame: 'FRAME', rectangle: 'RECTANGLE', text: 'TEXT', component: 'COMPONENT', group: 'GROUP' };

	// Union of the spec boxes, in the space the specs are given in.
	function specBounds(specs) {
		let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
		for (const spec of specs) {
			const box = spec.type === 'group'
				? specBounds(spec.children)
				: { x: spec.x, y: spec.y, width: spec.width, height: spec.height };
			left = Math.min(left, box.x);
			top = Math.min(top, box.y);
			right = Math.max(right, box.x + box.width);
			bottom = Math.max(bottom, box.y + box.height);
		}
		return { x: left, y: top, width: right - left, height: bottom - top };
	}

	function rotated(spec, x, y) {
		if (!spec.rotation) return at(x, y);
		const radians = spec.rotation * Math.PI / 180;
		return [[Math.cos(radians), Math.sin(radians), x], [-Math.sin(radians), Math.cos(radians), y]];
	}

	// Scene spec nodes: see figmaPage.ts. Groups take their members in the group's parent space.
	function buildSceneNodes(specs, parentId, offset, nodes) {
		const create = debug.nodes.create;
		const keys = debug.nodes.orderKeys(Math.max(specs.length, 1));
		specs.forEach((spec, position) => {
			const type = SCENE_TYPES[spec.type];
			if (!type) throw new Error('unknown scene node type "' + spec.type + '"');
			let box = { x: spec.x, y: spec.y, width: spec.width, height: spec.height };
			if (spec.type === 'group') box = specBounds(spec.children);
			const props = {
				name: spec.name, parentId, index: keys[position],
				transform: rotated(spec, box.x - offset.x, box.y - offset.y),
				width: box.width, height: box.height
			};
			if (spec.type !== 'group') props.fills = SCENE_FILLS[type];
			if (spec.type === 'text') props.textAutoResize = 'NONE';
			const node = create(type, props);
			nodes.push(node);
			if (spec.type === 'group') buildSceneNodes(spec.children, node.id, box, nodes);
			else buildSceneNodes(spec.children || [], node.id, { x: 0, y: 0 }, nodes);
		});
	}

	function buildScene(pageId, specs) {
		const nodes = [];
		buildSceneNodes(specs, pageId, { x: 0, y: 0 }, nodes);
		return nodes;
	}

	// The home screen covers the canvas while no file is open; open a blank one like a user would
	// (in a QA session that lands in the isolated .qa profile).
	async function ensureFileOpen() {
		if (debug.contextKeys.get('document.closed') !== true) return;
		await debug.commands.run('tabs.new');
		const deadline = performance.now() + 10000;
		while (debug.contextKeys.get('document.closed') === true) {
			if (performance.now() > deadline) throw new Error('no file opened after tabs.new');
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	async function resetLab(scene) {
		await ensureFileOpen();
		const { document, selection, history } = services();
		let page = document.pages().find((candidate) => candidate.name === LAB_PAGE);
		let pageId = page ? page.id : document.createPage(LAB_PAGE);
		document.setCurrentPage(pageId);
		const removals = document.children(pageId).flatMap((id) => document.removeNode(id));
		if (removals.length > 0) document.apply(removals, META);
		document.apply(document.insertNodes(scene ? buildScene(pageId, scene) : buildFixture(pageId)), META);
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		setViewport(1, { x: 400, y: 300 });
		selection.clear();
		history.clear();
	}

	const SCRATCH_PAGE = 'CDP lab 2';

	// A second page for experiments that cross pages; closeScratchPage removes it again.
	async function openScratchPage(scene) {
		const { document, selection, history } = services();
		const existing = document.pages().find((candidate) => candidate.name === SCRATCH_PAGE);
		const pageId = existing ? existing.id : document.createPage(SCRATCH_PAGE);
		document.setCurrentPage(pageId);
		const removals = document.children(pageId).flatMap((id) => document.removeNode(id));
		if (removals.length > 0) document.apply(removals, META);
		if (scene.length > 0) document.apply(document.insertNodes(buildScene(pageId, scene)), META);
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		setViewport(1, { x: 400, y: 300 });
		selection.clear();
		history.clear();
	}

	function closeScratchPage() {
		const { document, history } = services();
		const page = document.pages().find((candidate) => candidate.name === SCRATCH_PAGE);
		const lab = document.pages().find((candidate) => candidate.name === LAB_PAGE);
		if (lab) document.setCurrentPage(lab.id);
		if (page) document.deletePage(page.id);
		history.clear();
	}

	const PERF_PAGE = 'CDP perf';

	// Same scene as figmaPage.ts: count 8 px squares on a 10 px pitch in one frame, fitted.
	async function buildPerfScene(count, columns) {
		const started = performance.now();
		await ensureFileOpen();
		const { document, selection, history, viewport } = services();
		const page = document.pages().find((candidate) => candidate.name === PERF_PAGE);
		let pageId = page ? page.id : document.createPage(PERF_PAGE);
		document.setCurrentPage(pageId);
		const removals = document.children(pageId).flatMap((id) => document.removeNode(id));
		if (removals.length > 0) document.apply(removals, META);
		const rows = Math.ceil(count / columns);
		const create = debug.nodes.create;
		const grid = create('FRAME', { name: 'Perf grid', parentId: pageId, index: debug.nodes.orderKeys(1)[0], transform: at(0, 0), width: columns * 10 + 10, height: rows * 10 + 10 });
		const keys = debug.nodes.orderKeys(count);
		const nodes = [grid];
		const fills = solid(0.3, 0.5, 0.95);
		for (let index = 0; index < count; index += 1) {
			nodes.push(create('RECTANGLE', {
				name: 'P' + index, parentId: grid.id, index: keys[index], width: 8, height: 8, fills,
				transform: at(10 + (index % columns) * 10, 10 + Math.floor(index / columns) * 10)
			}));
		}
		document.apply(document.insertNodes(nodes), META);
		viewport.zoomToRect(document.absoluteBounds(grid.id));
		selection.clear();
		history.clear();
		return { ms: performance.now() - started, zoom: viewport.zoom };
	}

	function selectionCount() {
		return services().selection.ids.length;
	}

	function clearPerfScene() {
		const { document, history } = services();
		const page = document.pages().find((candidate) => candidate.name === PERF_PAGE);
		if (!page) return;
		const lab = document.pages().find((candidate) => candidate.name === LAB_PAGE);
		if (lab) document.setCurrentPage(lab.id);
		document.deletePage(page.id);
		history.clear();
	}

	// Our history has no open entry to close; setup edits are cleared by resetLab.
	function commitUndo() {}

	function undoDepth() {
		return services().history.entries.length;
	}

	// Every node on the lab page with its absolute box, parent by name, in document order.
	function listNodes() {
		const { document } = services();
		return document.query((node) => node.type !== 'PAGE', document.currentPageId).map((node) => {
			const box = document.absoluteBounds(node.id);
			const parent = document.get(node.parentId);
			return {
				id: node.id, name: node.name, type: node.type,
				parent: parent.type === 'PAGE' ? 'PAGE' : parent.name,
				x: box.x, y: box.y, width: box.width, height: box.height
			};
		});
	}

	function viewportInfo() {
		const { viewport } = services();
		return { zoom: viewport.zoom, bounds: viewport.visibleRect() };
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
		const { document, viewport } = services();
		return {
			target: 'app', file: document.documentName, page: document.currentPage.name,
			viewport: { camera: viewport.camera, size: viewport.size },
			canvasRect: canvasRect(), devicePixelRatio: window.devicePixelRatio,
			selection: sample().selection, pageChildren: pageChildren(), undoDepth: undoDepth()
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

export const APP_READY =
	'typeof window.__design_debug === "object" && !!window.__design_debug.document && !!window.__design_debug.nodes';
