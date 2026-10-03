import { expect, it } from 'vitest';

import {
	EndpointKind,
	LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createLayoutFrame } from '../../../../src/lib/core/layout/geometry/layout-frame';
import { clearGroupEndpointRoutes } from '../../../../src/lib/core/layout/group-endpoint-routing';
import type { LayoutRelation } from '../../../../src/lib/core/layout/layout-types';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

it('moves a group route before correcting a planned route that shares its rail', () => {
	const seed = validLogicDocument();
	const prepared = prepareLayoutDocument(
		{
			...seed,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'G',
					label: 'G',
					layoutOrder: orderKey('a1'),
				},
			],
			nodes: ['s', 'd', 't'].map((id, index) => ({
				kind: EndpointKind.Node,
				id,
				natureId: 'goal',
				markdown: id,
				layoutOrder: orderKey(`a${index + 3}`),
			})),
			junctions: [],
			relations: [
				{ id: 'barrier', from: 's', to: 'd' },
				{ id: 'shortcut', from: 'G', to: 't' },
			],
		},
		{
			nodes: {
				s: { width: 64, height: 40 },
				d: { width: 64, height: 40 },
				t: { width: 160, height: 80 },
			},
			groups: {
				G: {
					minimumWidth: 160,
					minimumHeight: 80,
					headerHeight: 4,
					padding: 4,
				},
			},
		},
	);
	const planned: LayoutRelation = {
		id: 'barrier',
		from: 's',
		to: 'd',
		points: [
			{ x: 32, y: 200 },
			{ x: 264, y: 200 },
			{ x: 264, y: 280 },
			{ x: 32, y: 280 },
			{ x: 32, y: 300 },
		],
	};
	const originalGroupRoute: LayoutRelation = {
		id: 'shortcut',
		from: 'G',
		to: 't',
		points: [
			{ x: 120, y: 120 },
			{ x: 120, y: 200 },
			{ x: 200, y: 200 },
			{ x: 200, y: 380 },
		],
	};
	const routes: LayoutRelation[] = [planned, originalGroupRoute];
	const bounds = new Map([
		['G', { x: 40, y: 40, width: 160, height: 80 }],
		['s', { x: 0, y: 160, width: 64, height: 40 }],
		['d', { x: 0, y: 300, width: 64, height: 40 }],
		['t', { x: 200, y: 340, width: 160, height: 80 }],
	]);

	clearGroupEndpointRoutes(
		prepared.graph,
		bounds,
		createLayoutFrame(LayoutDirection.TopToBottom, LayoutBias.Top),
		routes,
	);

	const barrier = routes.find(({ id }) => id === 'barrier');
	const shortcut = routes.find(({ id }) => id === 'shortcut');
	if (barrier === undefined || shortcut === undefined) throw new Error('Missing corrected routes');
	expect(barrier.points).toEqual(planned.points);
	expect(shortcut.points).not.toEqual(originalGroupRoute.points);
	expect(shortcut.points.some(({ x, y }) => x >= 120 && x <= 200 && y === 200)).toBe(false);
});
