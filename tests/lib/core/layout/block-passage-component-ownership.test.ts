import { expect, it } from 'vitest';

import {
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

it('keeps passage ports valid when a block contains disconnected relation components', () => {
	const base = validLogicDocument();
	const document: LogicDocument = {
		...base,
		layout: { direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'g0',
				label: 'g0',
				layoutOrder: orderKey('a0001'),
			},
			{
				kind: EndpointKind.Group,
				id: 'g1',
				label: 'g1',
				layoutOrder: orderKey('a0011'),
			},
			{
				kind: EndpointKind.Group,
				id: 'g2',
				label: 'g2',
				layoutOrder: orderKey('a0021'),
			},
		],
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'n0',
				natureId: 'goal',
				markdown: 'n0',
				layoutOrder: orderKey('a0031'),
				groupId: 'g2',
			},
			{
				kind: EndpointKind.Node,
				id: 'n1',
				natureId: 'goal',
				markdown: 'n1',
				layoutOrder: orderKey('a0041'),
			},
			{
				kind: EndpointKind.Node,
				id: 'n2',
				natureId: 'goal',
				markdown: 'n2',
				layoutOrder: orderKey('a0051'),
			},
			{
				kind: EndpointKind.Node,
				id: 'n3',
				natureId: 'goal',
				markdown: 'n3',
				layoutOrder: orderKey('a0061'),
			},
			{
				kind: EndpointKind.Node,
				id: 'n4',
				natureId: 'goal',
				markdown: 'n4',
				layoutOrder: orderKey('a0071'),
			},
			{
				kind: EndpointKind.Node,
				id: 'n5',
				natureId: 'goal',
				markdown: 'n5',
				layoutOrder: orderKey('a0081'),
			},
			{
				kind: EndpointKind.Node,
				id: 'n6',
				natureId: 'goal',
				markdown: 'n6',
				layoutOrder: orderKey('a0091'),
				groupId: 'g0',
			},
		],
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'j0',
				operator: 'xor',
				layoutOrder: orderKey('a0101'),
				groupId: 'g2',
			},
		],
		relations: [
			{ id: 'r0', from: 'n3', to: 'g2' },
			{ id: 'r1', from: 'n1', to: 'g2' },
			{ id: 'r2', from: 'n0', to: 'j0' },
			{ id: 'r3', from: 'n2', to: 'g2' },
			{ id: 'r4', from: 'n1', to: 'n4' },
			{ id: 'r5', from: 'n2', to: 'n3' },
			{ id: 'r6', from: 'n4', to: 'j0' },
		],
	};
	const prepared = prepareLayoutDocument(document, {
		nodes: {
			n0: { width: 82, height: 45 },
			n1: { width: 88, height: 63 },
			n2: { width: 131, height: 46 },
			n3: { width: 82, height: 142 },
			n4: { width: 296, height: 59 },
			n5: { width: 80, height: 93 },
			n6: { width: 150, height: 119 },
		},
		groups: {
			g0: {
				minimumWidth: 106,
				minimumHeight: 160,
				headerHeight: 39,
				padding: 29,
			},
			g1: {
				minimumWidth: 148,
				minimumHeight: 154,
				headerHeight: 43,
				padding: 12,
			},
			g2: {
				minimumWidth: 108,
				minimumHeight: 64,
				headerHeight: 28,
				padding: 13,
			},
		},
	});
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	const validation = validateDedicatedCandidate({ ...prepared, layout });
	expect(validation, JSON.stringify(validation)).toMatchObject({ valid: true });
});
