import { describe, expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { RegionCompositionStatus } from '../../../../src/lib/core/layout/region-composition-types';
import {
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../../../../src/lib/core/layout/region-geometry-diagnostic';
import {
	RegionIncidentRejectionCode,
	RegionIncidentRole,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
} from '../../../../src/lib/core/layout/region-incident-contract';
import {
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from '../../../../src/lib/core/layout/region-leaf-layout';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-portal-side';
import {
	diagnosedFailure,
	leafErrorAttempt,
	type RegionRetryState,
	retryIncidentFailure,
	retryLeafContractFailure,
} from '../../../../src/lib/core/layout/region-recursive-outcome';
import { RegionSearchProvenance } from '../../../../src/lib/core/layout/region-search-evidence';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { depthTwoRegionDocument, depthTwoRegionInput } from './nested-region-fixture';

function retryState(): RegionRetryState {
	const prepared = prepareLayoutDocument(depthTwoRegionDocument());
	const input = depthTwoRegionInput();
	const normalized = normalizeRegionCompositionModel(prepared.graph, {
		...input,
		regions: input.regions.map((region) => {
			if (region.id !== 'branch') return region;
			return {
				...region,
				layout: {
					direction: LayoutDirection.BottomToTop,
					bias: LayoutBias.Bottom,
				},
			};
		}),
	});
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error('Expected normalized two-level regions');
	const dispositionSides = new Map<string, RegionPortalSide>();
	return {
		context: {
			graph: prepared.graph,
			model: normalized.model,
			measurements: prepared.measurements,
			cache: undefined,
			ownershipByRelationId: new Map(
				normalized.model.relations.map((owned) => [owned.relation.id, owned]),
			),
			dispositionSideByRegionId: dispositionSides,
		},
		retriedOwners: new Set<string>(),
		dispositionSides,
	};
}

const blockedLeafWitness: RegionIncidentSearchWitness = {
	attempted: 1,
	exhaustive: true,
	rejectedAlternatives: [
		{
			relationId: 'inside-branch',
			endpointId: 'a-target',
			role: RegionIncidentRole.Source,
			side: RegionPortalSide.Bottom,
			code: RegionIncidentRejectionCode.RouteObstructed,
		},
	],
};

describe('recursive composition outcome', () => {
	it('keeps diagnostic provenance only when the validator supplied it', () => {
		const bare = regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.ParentRouteContact,
			'Routes touch.',
		);
		expect(diagnosedFailure(bare, 'Region validation failed.')).toEqual({
			attempt: {
				status: RegionCompositionStatus.Unknown,
				code: RegionGeometryDiagnosticCode.ParentRouteContact,
				reason: 'Region validation failed.',
			},
			diagnostic: bare,
		});
		const attributed = {
			...bare,
			regionId: 'branch',
			relationId: 'inside-branch',
		};
		expect(diagnosedFailure(attributed, 'Attributed failure.').attempt).toMatchObject({
			regionId: 'branch',
			relationId: 'inside-branch',
		});
	});

	it('retains typed leaf evidence without manufacturing absent fields', () => {
		expect(leafErrorAttempt(new Error('unrelated'))).toBeUndefined();
		expect(leafErrorAttempt(new UnsupportedRegionLeafLayoutError('No policy.'))).toEqual({
			status: RegionCompositionStatus.Unsupported,
			reason: 'No policy.',
		});
		expect(leafErrorAttempt(new UnknownRegionLeafLayoutError('No validated route.'))).toEqual({
			status: RegionCompositionStatus.Unknown,
			reason: 'No validated route.',
		});
		expect(
			leafErrorAttempt(
				new UnknownRegionLeafLayoutError(
					'All routes blocked.',
					{
						provenance: RegionSearchProvenance.Incident,
						code: RegionIncidentUnknownCode.NoValidAlternative,
						witness: blockedLeafWitness,
					},
					'left',
				),
			),
		).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			provenance: RegionSearchProvenance.Incident,
			code: RegionIncidentUnknownCode.NoValidAlternative,
			witness: blockedLeafWitness,
			regionId: 'left',
		});
	});

	it('retries each owning row at most once and only for typed failures', () => {
		const state = retryState();
		expect(retryLeafContractFailure(state, new Error('Route obstructed.'))).toBe(false);
		expect(
			retryLeafContractFailure(
				state,
				new UnknownRegionLeafLayoutError('No alternative.', {
					provenance: RegionSearchProvenance.Incident,
					code: RegionIncidentUnknownCode.NoValidAlternative,
					witness: blockedLeafWitness,
				}),
			),
		).toBe(true);
		expect(state.dispositionSides.get('branch')).toBe(RegionPortalSide.Top);
		expect(state.retriedOwners).toEqual(new Set(['branch']));
		expect(
			retryIncidentFailure(
				state,
				regionGeometryDiagnostic(
					RegionGeometryDiagnosticCode.IncidentWrongAttachment,
					'Another wording.',
					{ relationId: 'inside-branch' },
				),
			),
		).toBe(false);
		expect(state.dispositionSides.get('branch')).toBe(RegionPortalSide.Top);
		expect(
			retryIncidentFailure(
				state,
				regionGeometryDiagnostic(
					RegionGeometryDiagnosticCode.MissingIncidentNode,
					'Relation inside-branch touches another parent route.',
					{ relationId: 'inside-branch' },
				),
			),
		).toBe(false);
		const topSide = retryState();
		topSide.dispositionSides.set('branch', RegionPortalSide.Top);
		expect(
			retryIncidentFailure(
				topSide,
				regionGeometryDiagnostic(
					RegionGeometryDiagnosticCode.IncidentWrongAttachment,
					'Attachment invalid.',
					{ relationId: 'inside-branch' },
				),
			),
		).toBe(true);
		expect(topSide.dispositionSides.get('branch')).toBe(RegionPortalSide.Bottom);
	});
});
