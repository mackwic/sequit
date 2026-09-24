import { describe, expect, it } from 'vitest';

import {
	defined,
	LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import {
	regionQualifiedFailure,
	retryOwnerForIncidentFailure,
	retryOwnerForLeafContractFailure,
} from '../../../../src/lib/core/layout/nested-region-recursive-diagnostics';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-composition-types';
import {
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode as Code,
} from '../../../../src/lib/core/layout/region-geometry-diagnostic';
import {
	RegionIncidentRejectionCode,
	RegionIncidentRole,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
} from '../../../../src/lib/core/layout/region-incident-contract';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import { regionGridDocument } from '../../../support/builders/region-grid-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { depthTwoRegionDocument, depthTwoRegionInput } from './nested-region-fixture';

function retryModel() {
	const source = depthTwoRegionDocument();
	const prepared = prepareLayoutDocument(source);
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
	return normalized.model;
}

function gridRetryModel() {
	const source = regionGridDocument();
	const prepared = prepareLayoutDocument({
		...source,
		groups: source.groups.map((group) => {
			if (group.id !== 'orphan-group') return group;
			return { ...group, regionId: 'ordinary' };
		}),
	});
	const normalized = normalizeRegionCompositionModel(
		prepared.graph,
		nestedRegionInput(prepared.graph),
	);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		throw new Error(`Expected a normalized grid region: ${normalized.diagnostic.message}`);
	return normalized.model;
}

function rejectedWitness(
	entries: readonly {
		readonly relationId: string;
		readonly code: RegionIncidentRejectionCode;
	}[],
): RegionIncidentSearchWitness {
	return {
		attempted: entries.length,
		exhaustive: true,
		rejectedAlternatives: entries.map(({ relationId, code }) => ({
			relationId,
			endpointId: 'a-target',
			role: RegionIncidentRole.Source,
			side: RegionPortalSide.Bottom,
			code,
		})),
	};
}

describe('recursive retry diagnostics', () => {
	it('retries typed route and incident contacts at their internal row owner', () => {
		const model = retryModel();
		for (const [code, detail] of [
			[Code.ParentRouteContact, 'touches another parent route without a bridge'],
			[Code.IncidentCrossesForeignNode, 'crosses foreign node a-source'],
			[
				Code.IncidentTouchesLocalRelation,
				'touches local relation inside-a in leaf left without a defined bridge',
			],
			[Code.IncidentWrongAttachment, 'does not attach to node a-target on its bottom face'],
		] as const) {
			const message = `Relation inside-branch ${detail}`;
			const failure = regionGeometryDiagnostic(code, message, {
				relationId: 'inside-branch',
			});
			expect(retryOwnerForIncidentFailure(model, failure)).toBe('branch');
			expect(regionQualifiedFailure(model, failure)).toBe(`Region branch: ${message}`);
			expect(
				retryOwnerForIncidentFailure(model, {
					...failure,
					message: 'Reworded.',
				}),
			).toBe('branch');
		}
	});

	it('retries every internal row while excluding unrelated and leaf-owned failures', () => {
		const model = retryModel();
		for (const failure of [
			regionGeometryDiagnostic(Code.IncidentCrossesForeignNode, 'Any wording', {
				relationId: 'missing',
			}),
			regionGeometryDiagnostic(Code.IncidentCrossesForeignNode, 'Any wording', {
				relationId: 'inside-a',
			}),
		])
			expect(retryOwnerForIncidentFailure(model, failure)).toBeUndefined();
		expect(
			retryOwnerForIncidentFailure(
				model,
				regionGeometryDiagnostic(Code.IncidentCrossesForeignNode, 'Any wording', {
					relationId: 'at-root',
				}),
			),
		).toBe('@root');
		expect(
			regionQualifiedFailure(
				model,
				regionGeometryDiagnostic(
					Code.IncidentCrossesForeignNode,
					'Relation at-root crosses foreign node a-source',
					{ relationId: 'at-root' },
				),
			),
		).toBe('Relation at-root crosses foreign node a-source');
	});

	it('uses diagnostic identity and ownership rather than plausible wording', () => {
		const model = retryModel();
		const misleading = regionGeometryDiagnostic(
			Code.MissingIncidentNode,
			'Relation inside-branch crosses foreign node a-source',
			{ relationId: 'inside-branch' },
		);
		expect(retryOwnerForIncidentFailure(model, misleading)).toBeUndefined();
		expect(
			regionQualifiedFailure(
				model,
				regionGeometryDiagnostic(Code.LocalRelationMissing, 'Local relation absent', {
					relationId: 'inside-branch',
				}),
			),
		).toBe('Local relation absent');
		expect(
			regionQualifiedFailure(
				model,
				regionGeometryDiagnostic(Code.IncidentCrossesForeignNode, 'Unowned failure'),
			),
		).toBe('Unowned failure');
	});

	it('does not retry an incident owned by a grid disposition', () => {
		const model = gridRetryModel();
		const diagnostic = regionGeometryDiagnostic(
			Code.IncidentCrossesForeignNode,
			'Relation choice-to-target crosses a foreign node',
			{ relationId: 'choice-to-target' },
		);
		expect(
			model.relations.find(({ relation }) => relation.id === 'choice-to-target')?.ownerId,
		).toBe('branch');
		expect(retryOwnerForIncidentFailure(model, diagnostic)).toBeUndefined();
	});

	it('retries a rejected leaf route from typed relation provenance, regardless of wording', () => {
		const model = retryModel();
		const witness = {
			attempted: 1,
			exhaustive: true,
			rejectedAlternatives: [
				{
					relationId: 'inside-branch',
					endpointId: 'a-target',
					role: RegionIncidentRole.Source,
					side: RegionPortalSide.Bottom,
					code: RegionIncidentRejectionCode.RouteObstructed,
					reason: 'Any wording',
				},
			],
		};
		expect(
			retryOwnerForLeafContractFailure(
				model,
				RegionIncidentUnknownCode.NoValidAlternative,
				witness,
			),
		).toBe('branch');
		expect(
			retryOwnerForLeafContractFailure(model, RegionIncidentUnknownCode.NoValidAlternative, {
				...witness,
				rejectedAlternatives: [
					{
						...defined(witness.rejectedAlternatives[0]),
						reason: 'Reworded.',
					},
				],
			}),
		).toBe('branch');
		expect(
			retryOwnerForLeafContractFailure(model, RegionIncidentUnknownCode.InvalidContract, witness),
		).toBeUndefined();
	});

	it('walks rejected alternatives until a row-owned obstruction is found', () => {
		const model = retryModel();
		const witness = rejectedWitness([
			{
				relationId: 'inside-branch',
				code: RegionIncidentRejectionCode.PortUnavailable,
			},
			{
				relationId: 'missing',
				code: RegionIncidentRejectionCode.RouteObstructed,
			},
			{
				relationId: 'inside-a',
				code: RegionIncidentRejectionCode.RouteObstructed,
			},
			{
				relationId: 'inside-branch',
				code: RegionIncidentRejectionCode.RouteObstructed,
			},
		]);
		expect(
			retryOwnerForLeafContractFailure(
				model,
				RegionIncidentUnknownCode.NoValidAlternative,
				undefined,
			),
		).toBeUndefined();
		expect(
			retryOwnerForLeafContractFailure(
				model,
				RegionIncidentUnknownCode.NoValidAlternative,
				witness,
			),
		).toBe('branch');
	});

	it('keeps grid-owned rejected leaf routes out of row retries', () => {
		const model = gridRetryModel();
		const witness = rejectedWitness([
			{
				relationId: 'choice-to-target',
				code: RegionIncidentRejectionCode.RouteObstructed,
			},
		]);
		expect(
			retryOwnerForLeafContractFailure(
				model,
				RegionIncidentUnknownCode.NoValidAlternative,
				witness,
			),
		).toBeUndefined();
	});
});
