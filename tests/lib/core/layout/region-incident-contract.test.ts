import { describe, expect, it } from 'vitest';

import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	normalizeRegionIncidentContracts,
	type RegionIncidentContract,
	RegionIncidentRole,
} from '../../../../src/lib/core/layout/regions/model/region-incident-contract';

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
			['local', 0],
			['a', 1],
			['z', 2],
		]);
		expect(
			normalizeRegionIncidentContracts([later, earlier], positions).map(
				({ relation }) => relation.id,
			),
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
