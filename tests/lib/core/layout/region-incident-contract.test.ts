import { describe, expect, it } from 'vitest';

import { orderKey } from '../../../../src/lib/core/document/order-key';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	incidentEndpointPositions,
	normalizeRegionIncidentContracts,
	type RegionIncidentContract,
	RegionIncidentRole,
} from '../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { regionDocument } from './nested-region-fixture';

const sourceIncident: RegionIncidentContract = {
	relation: { id: 'z', from: 'local', to: 'foreign' },
	endpointId: 'local',
	role: RegionIncidentRole.Source,
	allowedSides: [RegionPortalSide.Bottom, RegionPortalSide.Right, RegionPortalSide.Bottom],
};

const targetIncident: RegionIncidentContract = {
	relation: { id: 'a', from: 'foreign', to: 'local' },
	endpointId: 'local',
	role: RegionIncidentRole.Target,
	allowedSides: [RegionPortalSide.Left, RegionPortalSide.Top],
};

describe('region incident contracts', () => {
	it('assigns endpoint positions from documentary layout order', () => {
		const source = regionDocument();
		const document = {
			...source,
			nodes: source.nodes.map((node) => {
				let layoutOrder = node.layoutOrder;
				if (node.id === 'a-target') layoutOrder = orderKey('a0');
				if (node.id === 'a-source') layoutOrder = orderKey('a1');
				return { ...node, layoutOrder };
			}),
		};
		const positions = incidentEndpointPositions(document);
		expect(positions.get('a-target')).toBe(0);
		expect(positions.get('a-source')).toBe(1);
	});
	it('orders incidents by endpoint and role, deduplicates sides, and preserves side preference', () => {
		const normalized = normalizeRegionIncidentContracts([
			sourceIncident,
			targetIncident,
			sourceIncident,
		]);
		expect(normalized).toEqual([
			{
				...sourceIncident,
				allowedSides: [RegionPortalSide.Bottom, RegionPortalSide.Right],
			},
			targetIncident,
		]);
		expect(normalizeRegionIncidentContracts([targetIncident, sourceIncident])).toEqual(normalized);
		expect(Object.isFrozen(normalized)).toBe(true);
		expect(Object.isFrozen(normalized[1]?.allowedSides)).toBe(true);
	});

	it('keeps source and target roles distinct for the same relation', () => {
		const relation = { id: 'same', from: 'local', to: 'local' };
		const source = { ...sourceIncident, relation };
		const target = { ...targetIncident, relation };
		expect(normalizeRegionIncidentContracts([target, source]).map(({ role }) => role)).toEqual([
			RegionIncidentRole.Source,
			RegionIncidentRole.Target,
		]);
	});

	it('uses opposite endpoint positions before relation IDs', () => {
		const later = {
			...sourceIncident,
			relation: { id: 'a', from: 'local', to: 'z' },
		};
		const earlier = {
			...sourceIncident,
			relation: { id: 'z', from: 'local', to: 'a' },
		};
		const positions = new Map([
			['local', 1],
			['a', 0],
			['z', 2],
		]);
		expect(
			normalizeRegionIncidentContracts([later, earlier], positions).map(
				({ relation }) => relation.id,
			),
		).toEqual(['z', 'a']);
		const incomingLater = {
			...targetIncident,
			relation: { id: 'a', from: 'z', to: 'local' },
		};
		const incomingEarlier = {
			...targetIncident,
			relation: { id: 'z', from: 'a', to: 'local' },
		};
		expect(
			normalizeRegionIncidentContracts([incomingLater, incomingEarlier], positions).map(
				({ relation }) => relation.id,
			),
		).toEqual(['z', 'a']);
	});
	it('orders local endpoints by documentary position and falls back to relation IDs only for parallels', () => {
		const laterLocal: RegionIncidentContract = {
			...sourceIncident,
			endpointId: 'z-local',
			relation: { id: 'a', from: 'z-local', to: 'a-foreign' },
		};
		const earlierLocal: RegionIncidentContract = {
			...sourceIncident,
			endpointId: 'a-local',
			relation: { id: 'z', from: 'a-local', to: 'z-foreign' },
		};
		const positions = new Map([
			['a-foreign', 0],
			['z-local', 1],
			['a-local', 3],
			['z-foreign', 4],
		]);
		expect(
			normalizeRegionIncidentContracts([earlierLocal, laterLocal], positions).map(
				({ relation }) => relation.id,
			),
		).toEqual(['a', 'z']);

		const firstParallel = {
			...sourceIncident,
			relation: { id: 'z-parallel', from: 'local', to: 'foreign' },
		};
		const secondParallel = {
			...sourceIncident,
			relation: { id: 'a-parallel', from: 'local', to: 'foreign' },
		};
		expect(
			normalizeRegionIncidentContracts(
				[firstParallel, secondParallel],
				new Map([
					['local', 0],
					['foreign', 1],
				]),
			).map(({ relation }) => relation.id),
		).toEqual(['a-parallel', 'z-parallel']);
	});
	it('uses stable identities for external endpoints missing documentary positions', () => {
		const laterEndpoint = {
			...sourceIncident,
			relation: { id: 'a', from: 'local', to: 'z-external' },
		};
		const earlierEndpoint = {
			...sourceIncident,
			relation: { id: 'z', from: 'local', to: 'a-external' },
		};
		expect(
			normalizeRegionIncidentContracts(
				[laterEndpoint, earlierEndpoint],
				new Map([['local', 0]]),
			).map(({ relation }) => relation.id),
		).toEqual(['z', 'a']);
	});

	it('rejects mismatched endpoints, unsupported sides, and conflicting duplicates', () => {
		expect(() =>
			normalizeRegionIncidentContracts([{ ...sourceIncident, endpointId: 'foreign' }]),
		).toThrow('source endpoint must be local');
		expect(() =>
			normalizeRegionIncidentContracts([{ ...sourceIncident, allowedSides: [] }]),
		).toThrow('at least one frame side');
		expect(() =>
			normalizeRegionIncidentContracts([
				sourceIncident,
				{ ...sourceIncident, allowedSides: [RegionPortalSide.Top] },
			]),
		).toThrow('Conflicting incident contract');
	});

	it('rejects malformed incident identities before they can enter a search key', () => {
		for (const relation of [
			{ ...sourceIncident.relation, id: '' },
			{ ...sourceIncident.relation, from: '' },
			{ ...sourceIncident.relation, to: '' },
		])
			expect(() => normalizeRegionIncidentContracts([{ ...sourceIncident, relation }])).toThrow(
				'Incident relation identities and endpoints must be nonempty.',
			);
		const invalidSide = { ...sourceIncident, allowedSides: [...sourceIncident.allowedSides] };
		Reflect.set(invalidSide.allowedSides, 0, 'diagonal');
		expect(() => normalizeRegionIncidentContracts([invalidSide])).toThrow(
			'Unknown incident frame side diagonal',
		);
		const invalidRole = { ...sourceIncident };
		Reflect.set(invalidRole, 'role', 'observer');
		expect(() => normalizeRegionIncidentContracts([invalidRole])).toThrow(
			'Unknown incident role observer',
		);
	});

	it('rejects duplicate identities whose endpoints, targets, or side preferences disagree', () => {
		for (const conflicting of [
			{
				...sourceIncident,
				relation: { ...sourceIncident.relation, from: 'another-local' },
				endpointId: 'another-local',
			},
			{ ...sourceIncident, relation: { ...sourceIncident.relation, to: 'another-foreign' } },
			{
				...sourceIncident,
				allowedSides: [RegionPortalSide.Right, RegionPortalSide.Bottom],
			},
		])
			expect(() => normalizeRegionIncidentContracts([sourceIncident, conflicting])).toThrow(
				'Conflicting incident contract',
			);
	});
});
