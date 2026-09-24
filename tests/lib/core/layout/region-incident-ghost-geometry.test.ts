import { describe, expect, it } from 'vitest';

import { EndpointKind } from '../../../../src/lib/core/document/logic-document';
import type { LayoutResult, Point } from '../../../../src/lib/core/layout/layout-types';
import { NestedPortalSide } from '../../../../src/lib/core/layout/nested-region-types';
import { geometryFailure } from '../../../../src/lib/core/layout/region-incident-ghost-common';
import { publicGeometryValid } from '../../../../src/lib/core/layout/region-incident-ghost-geometry';

const endpoint = {
	id: 'endpoint',
	kind: EndpointKind.Node,
	bounds: { x: 50, y: 50, width: 100, height: 60 },
} as const;

const valid: LayoutResult = {
	width: 200,
	height: 200,
	elements: [endpoint],
	relations: [],
};

const incident: readonly Point[] = [
	{ x: 100, y: 50 },
	{ x: 100, y: 0 },
];

describe('public incident geometry', () => {
	it('accepts an isolated orthogonal incident on a real node face', () => {
		expect(publicGeometryValid(valid, incident)).toBe(true);
		expect(geometryFailure(valid, endpoint, incident, NestedPortalSide.Top)).toBeUndefined();
	});

	it('rejects diagonal and out-of-canvas incidents and boxes', () => {
		expect(
			publicGeometryValid(valid, [
				{ x: 100, y: 50 },
				{ x: 101, y: 0 },
			]),
		).toBe(false);
		expect(
			publicGeometryValid(valid, [
				{ x: 201, y: 50 },
				{ x: 201, y: 0 },
			]),
		).toBe(false);
		expect(
			publicGeometryValid(
				{ ...valid, elements: [{ ...endpoint, bounds: { ...endpoint.bounds, x: -1 } }] },
				incident,
			),
		).toBe(false);
		expect(
			publicGeometryValid(
				{ ...valid, elements: [{ ...endpoint, bounds: { ...endpoint.bounds, width: 151 } }] },
				incident,
			),
		).toBe(false);
	});

	it('rejects a local route that is diagonal, leaves the canvas, or touches the incident', () => {
		const relation = { id: 'local', from: 'endpoint', to: 'endpoint' };
		expect(
			publicGeometryValid(
				{
					...valid,
					relations: [
						{
							...relation,
							points: [
								{ x: 50, y: 120 },
								{ x: 51, y: 121 },
							],
						},
					],
				},
				incident,
			),
		).toBe(false);
		expect(
			publicGeometryValid(
				{
					...valid,
					relations: [
						{
							...relation,
							points: [
								{ x: 50, y: 120 },
								{ x: 50, y: 201 },
							],
						},
					],
				},
				incident,
			),
		).toBe(false);
		expect(
			publicGeometryValid(
				{
					...valid,
					relations: [
						{
							...relation,
							points: [
								{ x: 80, y: 25 },
								{ x: 120, y: 25 },
							],
						},
					],
				},
				incident,
			),
		).toBe(false);
	});

	it('distinguishes invalid face, boundary, corner, and contact diagnostics', () => {
		expect(geometryFailure({ ...valid, height: 0 }, endpoint, incident, NestedPortalSide.Top)).toBe(
			'The projected leaf has no height.',
		);
		expect(geometryFailure(valid, endpoint, [], NestedPortalSide.Top)).toBe(
			'The auxiliary route has no incident anchors.',
		);
		expect(
			geometryFailure(
				valid,
				endpoint,
				[
					{ x: 100, y: 51 },
					{ x: 100, y: 0 },
				],
				NestedPortalSide.Top,
			),
		).toBe('The auxiliary route uses the wrong node face.');
		expect(
			geometryFailure(
				valid,
				endpoint,
				[
					{ x: 100, y: 50 },
					{ x: 100, y: 1 },
				],
				NestedPortalSide.Top,
			),
		).toBe('The auxiliary route misses the leaf boundary.');
		expect(
			geometryFailure(
				valid,
				endpoint,
				[
					{ x: 0, y: 50 },
					{ x: 0, y: 0 },
				],
				NestedPortalSide.Top,
			),
		).toBe('The auxiliary route reaches a leaf corner.');
		const blocked: LayoutResult = {
			...valid,
			relations: [
				{
					id: 'local',
					from: 'endpoint',
					to: 'endpoint',
					points: [
						{ x: 80, y: 25 },
						{ x: 120, y: 25 },
					],
				},
			],
		};
		expect(geometryFailure(blocked, endpoint, incident, NestedPortalSide.Top)).toBe(
			'The auxiliary route cannot form an isolated boundary incident.',
		);
	});
});
