import { expect, it } from 'vitest';

import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { RAIL_SPACING } from '../../../../src/lib/core/layout/layout-settings';
import { boundsFor, layoutDocument } from '../../../support/harnesses/layout';
import { referenceGroupShellViolations } from './bridge-oracle-reference';
import { shellDocument } from './group-shell-fixture';

it.each(Object.values(LayoutDirection))(
	'keeps bypass rails away from group shells in %s',
	async (direction) => {
		for (const count of [4, 5])
			for (const headerHeight of [36, 60, 90])
				for (const padding of [24, 36, 48]) {
					const original = shellDocument({ count, groups: 1, nested: false, edges: [] }, direction);
					const document = {
						...original,
						nodes: original.nodes.map((node, index) => {
							const result = { ...node };
							delete result.groupId;
							if (index === 1 || index === 2) result.groupId = 'g0';
							return result;
						}),
					};
					const { layout } = await layoutDocument(document, {
						groups: { g0: { minimumWidth: 160, minimumHeight: 72, headerHeight, padding } },
					});
					expect(
						referenceGroupShellViolations(
							layout.relations,
							[{ id: 'g0', bounds: boundsFor(layout, 'g0') }],
							RAIL_SPACING / 2,
						),
					).toEqual([]);
				}
	},
);

it.each(Object.values(LayoutDirection))(
	'keeps nested bypass rails away from both shells in %s',
	async (direction) => {
		const document = shellDocument(
			{
				count: 6,
				groups: 2,
				nested: true,
				edges: [
					[4, 0],
					[5, 1],
				],
			},
			direction,
		);
		const { layout } = await layoutDocument(document);
		expect(
			referenceGroupShellViolations(
				layout.relations,
				document.groups.map(({ id }) => ({ id, bounds: boundsFor(layout, id) })),
				RAIL_SPACING / 2,
			),
		).toEqual([]);
	},
);

it('rejects collinear and near-frame runs on all four sides, but permits perpendicular crossings', () => {
	const frame = { id: 'g', bounds: { x: 20, y: 20, width: 100, height: 100 } };
	const paths = [
		{
			id: 'top',
			points: [
				{ x: 0, y: 20 },
				{ x: 140, y: 20 },
			],
		},
		{
			id: 'bottom',
			points: [
				{ x: 40, y: 119 },
				{ x: 100, y: 119 },
			],
		},
		{
			id: 'left',
			points: [
				{ x: 9, y: 40 },
				{ x: 9, y: 100 },
			],
		},
		{
			id: 'right',
			points: [
				{ x: 120, y: 0 },
				{ x: 120, y: 140 },
			],
		},
		{
			id: 'clear',
			points: [
				{ x: 0, y: 8 },
				{ x: 140, y: 8 },
			],
		},
		{
			id: 'crossing',
			points: [
				{ x: 70, y: 0 },
				{ x: 70, y: 140 },
			],
		},
	];
	expect(referenceGroupShellViolations(paths, [frame], 12)).toEqual([
		{ pathId: 'top', frameId: 'g', segment: 1, distance: 0 },
		{ pathId: 'bottom', frameId: 'g', segment: 1, distance: 1 },
		{ pathId: 'left', frameId: 'g', segment: 1, distance: 11 },
		{ pathId: 'right', frameId: 'g', segment: 1, distance: 0 },
	]);
});
