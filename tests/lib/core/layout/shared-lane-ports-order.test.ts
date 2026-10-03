import { describe, expect, it } from 'vitest';

import { defined, LaneOrientation } from '../../../../src/lib/core/document/logic-document';
import {
	prepareSharedLanes,
	type SharedLaneInput,
} from '../../../../src/lib/core/layout/lanes/shared-lane-model';
import {
	incidentFaceKey,
	planSharedLanePorts,
} from '../../../../src/lib/core/layout/lanes/shared-lane-ports';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	type RegionIncidentContract,
	RegionIncidentRole,
} from '../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { configurations, documentFor } from './shared-lane-port-fixture';

function offsetsByExternalEndpoint(
	input: SharedLaneInput,
	contracts: readonly RegionIncidentContract[],
) {
	const ports = planSharedLanePorts(input, contracts);
	return contracts.map((contract) => ({
		externalEndpoint: contract.relation.to,
		offset: ports.incidentOffsetByFace.get(incidentFaceKey(contract, RegionPortalSide.Right)),
	}));
}

describe('shared lane incident port ordering', () => {
	it('preserves endpoint port positions when incident relation IDs are exchanged', () => {
		const document = documentFor(
			defined(configurations[0]),
			LaneOrientation.Parallel,
			[
				['a-target', 'A'],
				['b-source', 'B'],
				['z-target', 'C'],
			],
			[],
		);
		const prepared = prepareLayoutDocument(document);
		const input = defined(
			prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
		);
		const original: RegionIncidentContract[] = [
			{
				relation: { id: 'z-relation', from: 'b-source', to: 'external-a' },
				endpointId: 'b-source',
				role: RegionIncidentRole.Source,
				allowedSides: [RegionPortalSide.Right],
			},
			{
				relation: { id: 'a-relation', from: 'b-source', to: 'external-z' },
				endpointId: 'b-source',
				role: RegionIncidentRole.Source,
				allowedSides: [RegionPortalSide.Right],
			},
		];
		const renamed: RegionIncidentContract[] = [
			{
				relation: { id: 'a-relation', from: 'b-source', to: 'external-a' },
				endpointId: 'b-source',
				role: RegionIncidentRole.Source,
				allowedSides: [RegionPortalSide.Right],
			},
			{
				relation: { id: 'z-relation', from: 'b-source', to: 'external-z' },
				endpointId: 'b-source',
				role: RegionIncidentRole.Source,
				allowedSides: [RegionPortalSide.Right],
			},
		];

		expect(offsetsByExternalEndpoint(input, renamed)).toEqual(
			offsetsByExternalEndpoint(input, original),
		);
	});
});
