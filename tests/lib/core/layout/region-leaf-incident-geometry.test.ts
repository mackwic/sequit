import { describe, expect, it } from 'vitest';

import { EndpointKind } from '../../../../src/lib/core/document/logic-document';
import type { LayoutResult, Point } from '../../../../src/lib/core/layout/layout-types';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-composition-types';
import {
	RegionIncidentRejectionCode,
	RegionIncidentRole,
} from '../../../../src/lib/core/layout/region-incident-contract';
import {
	geometryFailure,
	routeCandidates,
	routeFor,
	slotsForAssignment,
} from '../../../../src/lib/core/layout/region-leaf-incident-geometry';

const endpoint = {
	id: 'local',
	kind: EndpointKind.Node,
	bounds: { x: 100, y: 60, width: 80, height: 40 },
} as const;

const layout: LayoutResult = {
	width: 300,
	height: 200,
	elements: [endpoint],
	relations: [],
};

const contract = {
	relation: { id: 'cross', from: 'local', to: 'foreign' },
	endpointId: 'local',
	role: RegionIncidentRole.Source,
	allowedSides: [RegionPortalSide.Top],
} as const;

const anchor = { x: 140, y: 60 };
const portal = { x: 140, y: 0 };

function path(points: readonly Point[]) {
	return routeFor(contract, RegionPortalSide.Top, points);
}

describe('dedicated leaf route geometry', () => {
	it('accepts a clear frame exit and rejects forged anchors, portals, and excursions', () => {
		expect(geometryFailure(layout, endpoint, path([anchor, portal]), [])).toBeUndefined();
		for (const points of [
			[
				{ x: 100, y: 60 },
				{ x: 100, y: 0 },
			],
			[anchor, { x: 140, y: -8 }, { x: 0, y: -8 }, { x: 0, y: 0 }],
			[anchor, { x: 150, y: 0 }],
			[anchor, { x: 140, y: -8 }, { x: 160, y: -8 }, { x: 160, y: 0 }],
			[anchor, { x: -8, y: 60 }, { x: -8, y: 0 }, portal],
		] as const) {
			const failure = geometryFailure(layout, endpoint, path(points), []);
			expect(failure).toBeDefined();
		}
		expect(
			geometryFailure(
				layout,
				endpoint,
				path([
					{ x: 100, y: 60 },
					{ x: 100, y: 0 },
				]),
				[],
			)?.code,
		).toBe(RegionIncidentRejectionCode.InvalidAttachment);
		expect(geometryFailure(layout, endpoint, path([anchor, { x: 150, y: 0 }]), [])?.code).toBe(
			RegionIncidentRejectionCode.GeometryInvalid,
		);
	});

	it('distinguishes an occupied endpoint, a local relation, and a concurrent incident', () => {
		const blocker = {
			id: 'blocker',
			kind: EndpointKind.Node,
			bounds: { x: 130, y: 20, width: 20, height: 20 },
		} as const;
		expect(
			geometryFailure(
				{ ...layout, elements: [endpoint, blocker] },
				endpoint,
				path([anchor, portal]),
				[],
			)?.reason,
		).toContain('endpoint blocker');
		const localRelation = {
			id: 'local-route',
			from: 'left',
			to: 'right',
			points: [
				{ x: 120, y: 40 },
				{ x: 160, y: 40 },
			],
		};
		// The full candidate has a strict crossing with room for an arc on either route.
		expect(
			geometryFailure(
				{ ...layout, relations: [localRelation] },
				endpoint,
				path([anchor, portal]),
				[],
			),
		).toBeUndefined();
		const narrow = {
			...localRelation,
			points: [
				{ x: 135, y: 40 },
				{ x: 140, y: 40 },
			],
		};
		expect(
			geometryFailure({ ...layout, relations: [narrow] }, endpoint, path([anchor, portal]), [])
				?.reason,
		).toContain('local relation local-route');
		const previous = routeFor(
			{ ...contract, relation: { id: 'earlier', from: 'local', to: 'another' } },
			RegionPortalSide.Left,
			[
				{ x: 135, y: 40 },
				{ x: 140, y: 40 },
			],
		);
		expect(geometryFailure(layout, endpoint, path([anchor, portal]), [previous])?.reason).toContain(
			'incident earlier',
		);
	});

	it('keeps a direct route when its endpoint is close to the frame', () => {
		expect(routeCandidates({ x: 140, y: 8 }, RegionPortalSide.Top, layout)).toEqual([
			[
				{ x: 140, y: 8 },
				{ x: 140, y: 0 },
			],
		]);
	});

	it('allows an existing incoming route to meet an incident only at its endpoint', () => {
		const incoming = {
			id: 'incoming',
			from: 'previous',
			to: 'local',
			points: [{ x: 140, y: 80 }, anchor],
		};
		expect(
			geometryFailure({ ...layout, relations: [incoming] }, endpoint, path([anchor, portal]), []),
		).toBeUndefined();
	});

	it('rejects incomplete assignments and empty paths before geometry validation', () => {
		expect(() => slotsForAssignment([contract], [])).toThrow('side assignment is incomplete');
		expect(() => routeFor(contract, RegionPortalSide.Top, [])).toThrow('incident route is empty');
	});

	it('reserves ports per endpoint and face for two incoming incidents', () => {
		const first = {
			...contract,
			relation: { id: 'first', from: 'foreign-a', to: 'local' },
			role: RegionIncidentRole.Target,
		};
		const second = {
			...first,
			relation: { id: 'second', from: 'foreign-b', to: 'local' },
		};
		const otherEndpoint = {
			...contract,
			relation: { id: 'other', from: 'other', to: 'foreign' },
			endpointId: 'other',
		};
		const otherFace = {
			...contract,
			relation: { id: 'bottom', from: 'local', to: 'foreign' },
		};
		const slots = slotsForAssignment(
			[first, otherEndpoint, second, otherFace],
			[RegionPortalSide.Top, RegionPortalSide.Top, RegionPortalSide.Top, RegionPortalSide.Bottom],
		);
		expect(slots.map(({ preferredFraction }) => preferredFraction)).toEqual([
			1 / 3,
			1 / 2,
			2 / 3,
			1 / 2,
		]);
	});
});
