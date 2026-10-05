import { describe, expect, it } from 'vitest';
import { parseDesignDocument, plainText } from '../../lib/document';
import { buildFixtureDocument } from './fixture';

describe('components page of the scene fixture', () => {
	const document = buildFixtureDocument();

	it('is a valid document', () => {
		expect(parseDesignDocument(document).ok).toBe(true);
	});

	it('has mains, instances and a variant set', () => {
		const types = (ids: string[]): string[] => ids.map((id) => document.nodes[id].type);
		expect(types(['component-button', 'component-tag', 'chip-small'])).toEqual([
			'COMPONENT',
			'COMPONENT',
			'COMPONENT'
		]);
		expect(document.nodes['component-set-chip'].type).toBe('COMPONENT_SET');
		expect(types(['instance-button-default', 'instance-chip', 'instance-tag'])).toEqual([
			'INSTANCE',
			'INSTANCE',
			'INSTANCE'
		]);
	});

	it('links instance layers to their main and records the overrides', () => {
		const overridden = document.nodes['instance-button-override'];
		expect(overridden.touched).toContain('fills');
		const label = Object.values(document.nodes).find(
			(node) => node.parentId === overridden.id && node.componentRef === 'component-button-label'
		);
		expect(label?.touched).toEqual(['text-content']);
	});

	it('applies component property values to the bound layers', () => {
		const icon = document.nodes['instance-button-properties-1'];
		expect(icon.componentRef).toBe('component-button-icon');
		expect(Reflect.get(icon, 'visible')).toBe(false);
		const label = document.nodes['instance-button-properties-2'];
		if (label.type !== 'TEXT') throw new Error('not text');
		expect(plainText(label.paragraphs)).toBe('Buy now');
	});
});
