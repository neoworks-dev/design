import type { Context } from '@neoworks/extension-system';
import type { Component } from 'svelte';
import ExportSection from './ExportSection.svelte';
import PageSection from './PageSection.svelte';
import StylesSection from './StylesSection.svelte';
import VariablesSection from './VariablesSection.svelte';

interface PageSectionEntry {
	id: string;
	title: string;
	order: number;
	component: Component;
}

const SECTIONS: PageSectionEntry[] = [
	{ id: 'page', title: 'Page', order: 0, component: PageSection },
	{ id: 'variables', title: 'Variables', order: 1, component: VariablesSection },
	{ id: 'styles', title: 'Styles', order: 2, component: StylesSection },
	{ id: 'export', title: 'Export', order: 3, component: ExportSection }
];

// What the Design tab shows while nothing is selected: page background, local variables, local
// styles and the page's export settings.
export default {
	name: 'inspector-page',
	inject: ['inspectors', 'document', 'variables', 'colorPicker', 'commands'],
	apply(ctx: Context): void {
		for (const section of SECTIONS) {
			ctx.effect(
				() =>
					ctx.inspectors.register({
						id: section.id,
						tab: 'design',
						title: section.title,
						order: section.order,
						applies: (selection) => selection.count === 0,
						component: section.component
					}),
				`page section ${section.id}`
			);
		}
	}
};
