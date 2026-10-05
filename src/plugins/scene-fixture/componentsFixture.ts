// The "Components" page of the scene fixture: main components, instances (untouched, overridden
// and with component properties), a variant set and an auto layout component. Mains are plain
// node specs; the instances are built by the sync engine itself, so the fixture exercises it.

import {
	applyChanges,
	applyWithComponentSync,
	DocumentStore,
	planCreateInstance,
	planSetProps,
	type DesignDocument,
	type Matrix2x3,
	type Paint,
	type Paragraph
} from '../../lib/document';
import { node, page, rectangle, text, type NodeSpec } from '../../lib/document/fixtures';

export const COMPONENTS_PAGE_ID = 'page-components';

function translation(x: number, y: number): Matrix2x3 {
	return [
		[1, 0, x],
		[0, 1, y]
	];
}

const BRAND: Paint = solid(0.36, 0.28, 0.9);
const WHITE: Paint = solid(1, 1, 1);
const PALE: Paint = solid(0.93, 0.9, 1);
const GREEN: Paint = solid(0.12, 0.65, 0.4);

function solid(red: number, green: number, blue: number): Paint {
	return {
		type: 'SOLID',
		visible: true,
		opacity: 1,
		blendMode: 'NORMAL',
		color: { r: red, g: green, b: blue }
	};
}

function label(content: string, color: Paint): Paragraph[] {
	return [
		{
			runs: [{ text: content, style: { fills: [color] } }],
			align: 'LEFT',
			indent: 0,
			spacingAfter: 0,
			list: 'NONE',
			listLevel: 0
		}
	];
}

function buttonMain(): NodeSpec {
	return node(
		'COMPONENT',
		{
			id: 'component-button',
			name: 'Button',
			width: 160,
			height: 48,
			transform: translation(40, 60),
			fills: [BRAND],
			cornerRadius: 10,
			description: 'Primary action',
			componentPropertyDefinitions: {
				'Show icon': { type: 'BOOLEAN', defaultValue: true },
				Label: { type: 'TEXT', defaultValue: 'Button' }
			}
		},
		[
			node('ELLIPSE', {
				id: 'component-button-icon',
				name: 'Icon',
				width: 16,
				height: 16,
				transform: translation(16, 16),
				fills: [WHITE],
				componentPropertyReferences: { visible: 'Show icon' }
			}),
			text({
				id: 'component-button-label',
				name: 'Label',
				width: 100,
				height: 20,
				transform: translation(44, 14),
				paragraphs: label('Button', WHITE),
				componentPropertyReferences: { characters: 'Label' }
			})
		]
	);
}

function variant(
	id: string,
	x: number,
	y: number,
	size: string,
	state: string,
	fill: Paint
): NodeSpec {
	const width = size === 'Small' ? 80 : 120;
	return node(
		'COMPONENT',
		{
			id,
			name: `Size=${size}, State=${state}`,
			width,
			height: 32,
			transform: translation(x, y),
			fills: [fill],
			cornerRadius: 16,
			variantProperties: { Size: size, State: state }
		},
		[
			text({
				id: `${id}-label`,
				name: 'Label',
				width: width - 24,
				height: 18,
				transform: translation(12, 7),
				paragraphs: label('Chip', WHITE)
			})
		]
	);
}

function chipSet(): NodeSpec {
	return node(
		'COMPONENT_SET',
		{
			id: 'component-set-chip',
			name: 'Chip',
			width: 192,
			height: 168,
			transform: translation(40, 300),
			clipsContent: false,
			cornerRadius: 5,
			strokes: [
				{
					paints: [solid(0.592, 0.278, 1)],
					weight: 1,
					align: 'INSIDE',
					cap: 'NONE',
					join: 'MITER',
					miterLimit: 4,
					dashPattern: [6, 4]
				}
			],
			componentPropertyDefinitions: {
				Size: { type: 'VARIANT', defaultValue: 'Small', variantOptions: ['Small', 'Large'] },
				State: { type: 'VARIANT', defaultValue: 'Default', variantOptions: ['Default', 'Active'] }
			}
		},
		[
			variant('chip-small', 24, 24, 'Small', 'Default', BRAND),
			variant('chip-large', 24, 72, 'Large', 'Default', BRAND),
			variant('chip-large-active', 24, 120, 'Large', 'Active', GREEN)
		]
	);
}

function tagMain(): NodeSpec {
	return node(
		'COMPONENT',
		{
			id: 'component-tag',
			name: 'Tag',
			width: 112,
			height: 36,
			transform: translation(40, 540),
			fills: [PALE],
			cornerRadius: 18,
			layoutMode: 'HORIZONTAL',
			primaryAxisSizingMode: 'FIXED',
			counterAxisSizingMode: 'FIXED',
			counterAxisAlignItems: 'CENTER',
			itemSpacing: 8,
			paddingLeft: 12,
			paddingRight: 12,
			paddingTop: 8,
			paddingBottom: 8
		},
		[
			rectangle({
				id: 'component-tag-dot',
				name: 'Dot',
				width: 12,
				height: 12,
				transform: translation(12, 12),
				fills: [BRAND],
				cornerRadius: 6
			}),
			text({
				id: 'component-tag-label',
				name: 'Label',
				width: 60,
				height: 18,
				transform: translation(32, 9),
				paragraphs: label('Tag', solid(0.15, 0.12, 0.35))
			})
		]
	);
}

export function componentsPage(): NodeSpec {
	return page('Components', [buttonMain(), chipSet(), tagMain()], { id: COMPONENTS_PAGE_ID });
}

/** The root gets the readable id, its layers `<id>-1`, `<id>-2`, ... */
function readableIds(rootId: string): () => string {
	let issued = 0;
	return () => {
		issued += 1;
		if (issued === 1) return rootId;
		return `${rootId}-${issued - 1}`;
	};
}

function instanceAt(
	store: DocumentStore,
	mainId: string,
	id: string,
	name: string,
	x: number,
	y: number
): void {
	const plan = planCreateInstance(store, mainId, {
		idGenerator: readableIds(id),
		transform: translation(x, y)
	});
	applyWithComponentSync(store, plan.changes);
	// A plain rename, not an override: the instance should start without any touched group.
	applyChanges(store, planSetProps(store, plan.rootId, { name }));
}

function copyOf(store: DocumentStore, instanceId: string, ref: string): string {
	const copy = store.descendants(instanceId).find((candidate) => candidate.componentRef === ref);
	if (copy === undefined) throw new Error(`no copy of ${ref} in ${instanceId}`);
	return copy.id;
}

/** Instances for the Components page, built with the engine: needs the page's mains in place. */
export function addComponentInstances(document: DesignDocument): void {
	const store = new DocumentStore(document);
	instanceAt(store, 'component-button', 'instance-button-default', 'Button', 280, 60);
	instanceAt(store, 'component-button', 'instance-button-override', 'Button override', 480, 60);
	instanceAt(store, 'component-button', 'instance-button-properties', 'Button properties', 680, 60);
	instanceAt(store, 'chip-large-active', 'instance-chip', 'Chip', 300, 340);
	instanceAt(store, 'component-tag', 'instance-tag', 'Tag', 280, 540);
	overrideButtons(store);
}

function overrideButtons(store: DocumentStore): void {
	applyWithComponentSync(
		store,
		planSetProps(store, 'instance-button-override', { fills: [GREEN] })
	);
	const overrideLabel = copyOf(store, 'instance-button-override', 'component-button-label');
	applyWithComponentSync(
		store,
		planSetProps(store, overrideLabel, { paragraphs: label('Override', WHITE) })
	);
	const instance = store.requireNode('instance-button-properties');
	if (instance.type !== 'INSTANCE') return;
	applyWithComponentSync(
		store,
		planSetProps(store, instance.id, {
			componentProperties: {
				...instance.componentProperties,
				'Show icon': { type: 'BOOLEAN', value: false },
				Label: { type: 'TEXT', value: 'Buy now' }
			}
		})
	);
}
