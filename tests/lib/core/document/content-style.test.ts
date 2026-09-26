import { describe, expect, it } from 'vitest';

import {
	styleDocumentNature,
	styleDocumentNode,
} from '../../../../src/lib/core/document/content-style';
import { validLogicDocument } from '../../../support/builders/logic-document';

describe('document content styles', () => {
	it('sets and clears node overrides without altering a different node', () => {
		const document = validLogicDocument();
		const [source, otherNode] = document.nodes;
		if (source === undefined || otherNode === undefined) throw new Error('Fixture nodes missing');

		const styled = styleDocumentNode(document, 'source-a', {
			color: '#b91c1c',
			icon: 'phosphor:target',
		});
		expect(styled.nodes[0]).toEqual({ ...source, color: '#b91c1c', icon: 'phosphor:target' });
		expect(styled.nodes[1]).toEqual(otherNode);

		const reset = styleDocumentNode(styled, 'source-a', {});
		expect(reset.nodes).toEqual(document.nodes);
	});

	it('keeps nature base colors while allowing an explicit icon and restoring inherited absence', () => {
		const base = validLogicDocument();
		const concern = { id: 'concern', label: 'Concern', color: '#64748b' };
		const document = { ...base, natures: [...base.natures, concern] };
		const goal = document.natures[0];
		if (goal === undefined) throw new Error('Fixture nature missing');

		const colored = styleDocumentNature(document, 'goal', {
			color: '#334155',
			icon: 'phosphor:scales',
		});
		expect(colored.natures[0]).toEqual({ ...goal, color: '#334155', icon: 'phosphor:scales' });
		expect(colored.natures[1]).toEqual(concern);
		expect(colored.nodes).toEqual(document.nodes);

		const withoutIcon = styleDocumentNature(colored, 'goal', {});
		expect(withoutIcon.natures[0]).toEqual({ ...goal, color: '#334155' });
		expect(withoutIcon.natures[0]).not.toHaveProperty('icon');
	});

	it('rejects edits for nodes and natures that are not in the document', () => {
		const document = validLogicDocument();
		expect(() => styleDocumentNode(document, 'missing-node', {})).toThrow('Unknown node');
		expect(() => styleDocumentNature(document, 'missing-nature', {})).toThrow('Unknown nature');
	});
});
