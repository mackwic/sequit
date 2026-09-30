import { describe, expect, it } from 'vitest';

import {
	defined,
	LaneGrowth,
	LaneOrientation,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	REGION_POLICY_PERSISTENCE_FORMAT,
	REGION_POLICY_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import {
	leafDocument,
	leafIncidentContracts,
} from '../../../../src/lib/core/layout/regions/composition/nested-region-recursive-model-adapter';
import {
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from '../../../../src/lib/core/layout/regions/leaf/region-leaf-layout';
import { solveRegionLeafLayoutWithIncidents } from '../../../../src/lib/core/layout/regions/leaf/region-leaf-layout';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	incidentEndpointPositions,
	RegionIncidentRejectionCode,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
} from '../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-portal-side';
import { RegionSearchProvenance } from '../../../../src/lib/core/layout/regions/model/region-search-evidence';
import { nestedRegionLocalMeasurements } from '../../../../src/lib/core/layout/regions/recursive/nested-region-local-measurements';
import {
	diagnosedFailure,
	leafErrorAttempt,
	type RegionRetryState,
	retryIncidentFailure,
	retryLeafContractFailure,
} from '../../../../src/lib/core/layout/regions/recursive/region-recursive-outcome';
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
			endpointPositions: incidentEndpointPositions(prepared.graph.document),
			ownershipByRelationId: new Map(
				normalized.model.relations.map((owned) => [owned.relation.id, owned]),
			),
			dispositionSideByRegionId: dispositionSides,
		},
		retriedOwners: new Set<string>(),
		dispositionSides,
	};
}

function actualIncidentFailure(): {
	readonly state: RegionRetryState;
	readonly error: UnknownRegionLeafLayoutError;
	readonly witness: RegionIncidentSearchWitness;
} {
	const source = depthTwoRegionDocument();
	const node = defined(source.nodes.find(({ id }) => id === 'c'));
	const sourceIds = ['a1', 'a2', 'b1', 'b2'];
	const targetIds = ['t0', 't1'];
	const endpointIds = [...sourceIds, ...targetIds, 'middle-node'];
	const input: RegionInput = {
		regions: [
			{ id: '@root', layoutOrder: '0' },
			{ id: 'branch', parentId: '@root', layoutOrder: 'a' },
			{
				id: 'left',
				parentId: 'branch',
				layoutOrder: 'a',
				policy: LayoutPolicy.SharedLanes,
				lanePresentation: {
					laneOrientation: LaneOrientation.Transverse,
					growth: LaneGrowth.Auto,
					lanes: ['A', 'B'].map((id, index) => ({
						id,
						label: id,
						layoutOrder: orderKey(`a${index}`),
					})),
				},
			},
			{ id: 'middle', parentId: 'branch', layoutOrder: 'b' },
			{ id: 'far', parentId: 'branch', layoutOrder: 'c' },
		],
		regionByEndpointId: new Map([
			...sourceIds.map((id) => [id, 'left'] as const),
			...targetIds.map((id) => [id, 'far'] as const),
			['middle-node', 'middle'],
		]),
	};
	const document: LogicDocument = {
		...source,
		persistenceFormat: REGION_POLICY_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_POLICY_PRESENTATION_SCHEMA,
			regions: input.regions
				.filter(({ id }) => id !== '@root')
				.map((region, index) => {
					const { parentId, ...definition } = region;
					const persisted = {
						...definition,
						layoutOrder: orderKey(`a${index}`),
						policy: region.policy ?? LayoutPolicy.Layered,
					};
					if (parentId === '@root' || parentId === undefined) return persisted;
					return { ...persisted, parentId };
				}),
		},
		nodes: endpointIds.map((id, index) => {
			const laneField: { laneId?: string } = {};
			if (sourceIds.includes(id)) laneField.laneId = defined(id[0]).toUpperCase();
			return {
				...node,
				id,
				regionId: defined(input.regionByEndpointId.get(id)),
				markdown: `${id}\n`,
				...laneField,
				layoutOrder: orderKey(`a${index}`),
			};
		}),
		relations: [
			{ id: 'local', from: 'a1', to: 'a2' },
			...targetIds.map((id, index) => ({ id: `cross-${index}`, from: 'a1', to: id })),
		],
	};
	const prepared = prepareLayoutDocument(document);
	const normalized = normalizeRegionCompositionModel(prepared.graph, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error('Expected a normalized row with real crossing relations.');
	const model = normalized.model;
	const dispositionSides = new Map<string, RegionPortalSide>();
	const state: RegionRetryState = {
		context: {
			graph: prepared.graph,
			model,
			measurements: prepared.measurements,
			cache: undefined,
			endpointPositions: incidentEndpointPositions(prepared.graph.document),
			ownershipByRelationId: new Map(model.relations.map((owned) => [owned.relation.id, owned])),
		},
		retriedOwners: new Set<string>(),
		dispositionSides,
	};
	const local = leafDocument(state.context, 'left');
	const incidentSides = new Map<string, readonly RegionPortalSide[]>(
		targetIds.map((_, index) => [`cross-${index}`, [RegionPortalSide.Left]]),
	);
	const contracts = leafIncidentContracts(state.context, 'left', incidentSides);
	const attempt = solveRegionLeafLayoutWithIncidents({
		document: local,
		measurements: nestedRegionLocalMeasurements(local, prepared.measurements),
		leafPolicy: LayoutPolicy.SharedLanes,
		contracts,
	});
	if (
		attempt.status !== RegionCompositionStatus.Unknown ||
		attempt.code !== RegionIncidentUnknownCode.NoValidAlternative ||
		!attempt.witness.exhaustive ||
		!attempt.witness.rejectedAlternatives.some(
			({ code, reason }) =>
				code === RegionIncidentRejectionCode.RouteObstructed &&
				reason?.includes('crosses node') === true,
		)
	)
		throw new Error('Expected an exhaustive rejection from real leaf incident routes.');
	const error = new UnknownRegionLeafLayoutError(
		attempt.reason,
		{
			provenance: RegionSearchProvenance.Incident,
			code: attempt.code,
			witness: attempt.witness,
		},
		'left',
	);
	return { state, error, witness: attempt.witness };
}

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

	it('retains real incident-search evidence without manufacturing absent fields', () => {
		expect(leafErrorAttempt(new Error('unrelated'))).toBeUndefined();
		expect(leafErrorAttempt(new UnsupportedRegionLeafLayoutError('No policy.'))).toEqual({
			status: RegionCompositionStatus.Unsupported,
			reason: 'No policy.',
		});
		const { error, witness } = actualIncidentFailure();
		expect(leafErrorAttempt(error)).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			provenance: RegionSearchProvenance.Incident,
			code: RegionIncidentUnknownCode.NoValidAlternative,
			witness,
			regionId: 'left',
		});
		expect(witness.attempted).toBeGreaterThan(0);
		expect(witness.exhaustive).toBe(true);
	});

	it('retries once from a real exhausted leaf incident witness', () => {
		const { state, error } = actualIncidentFailure();
		expect(retryLeafContractFailure(state, new Error('Route obstructed.'))).toBe(false);
		expect(retryLeafContractFailure(state, error)).toBe(true);
		expect(state.dispositionSides.get('branch')).toBe(RegionPortalSide.Bottom);
		expect(state.retriedOwners).toEqual(new Set(['branch']));
		expect(retryLeafContractFailure(state, error)).toBe(false);
		expect(
			retryIncidentFailure(
				state,
				regionGeometryDiagnostic(
					RegionGeometryDiagnosticCode.IncidentWrongAttachment,
					'Another wording.',
					{ relationId: 'cross-0' },
				),
			),
		).toBe(false);
		const stateWithoutRetryableDiagnostic = retryState();
		expect(
			retryIncidentFailure(
				stateWithoutRetryableDiagnostic,
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
