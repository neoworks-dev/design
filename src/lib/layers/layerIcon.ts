// Which icon a layer row shows and whether it is drawn in the component colour.

import type { Component } from 'svelte';
import CropIcon from 'phosphor-svelte/lib/CropIcon';
import CircleIcon from 'phosphor-svelte/lib/CircleIcon';
import DiamondIcon from 'phosphor-svelte/lib/DiamondIcon';
import DiamondsFourIcon from 'phosphor-svelte/lib/DiamondsFourIcon';
import FileIcon from 'phosphor-svelte/lib/FileIcon';
import HashIcon from 'phosphor-svelte/lib/HashIcon';
import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
import IntersectSquareIcon from 'phosphor-svelte/lib/IntersectSquareIcon';
import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
import NotchesIcon from 'phosphor-svelte/lib/NotchesIcon';
import PenNibIcon from 'phosphor-svelte/lib/PenNibIcon';
import PolygonIcon from 'phosphor-svelte/lib/PolygonIcon';
import SelectionIcon from 'phosphor-svelte/lib/SelectionIcon';
import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
import StarIcon from 'phosphor-svelte/lib/StarIcon';
import TextTIcon from 'phosphor-svelte/lib/TextTIcon';
import type { Node, NodeType } from '../document';

// phosphor-svelte icons accept more props than `size` and `weight`
// oxlint-disable-next-line typescript/no-explicit-any
type IconComponent = Component<any>;

const ICONS: Record<NodeType, IconComponent> = {
	PAGE: FileIcon,
	FRAME: HashIcon,
	GROUP: SelectionIcon,
	SECTION: NotchesIcon,
	RECTANGLE: SquareIcon,
	ELLIPSE: CircleIcon,
	LINE: MinusIcon,
	POLYGON: PolygonIcon,
	STAR: StarIcon,
	VECTOR: PenNibIcon,
	TEXT: TextTIcon,
	BOOLEAN_OPERATION: IntersectSquareIcon,
	COMPONENT: DiamondsFourIcon,
	COMPONENT_SET: DiamondsFourIcon,
	INSTANCE: DiamondIcon,
	SLICE: CropIcon
};

function hasImageFill(node: Node): boolean {
	const fills: unknown = Reflect.get(node, 'fills');
	if (!Array.isArray(fills)) return false;
	return fills.some((fill: unknown) => Reflect.get(Object(fill), 'type') === 'IMAGE');
}

export function layerIcon(node: Node): IconComponent {
	if (node.type === 'RECTANGLE' && hasImageFill(node)) return ImageIcon;
	return ICONS[node.type];
}

/** Components, component sets and instances are listed in the component colour. */
export function isComponentLike(node: Node): boolean {
	return node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || node.type === 'INSTANCE';
}
