import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	LayoutPolicy,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	changeDocumentMembership,
	dissolveDocumentGroup,
	groupDocumentNodes,
} from '../../../../src/lib/infrastructure/document/document-group-operations';
import {
	explicitLaneLogicDocument,
	validLogicDocument,
} from '../../../support/builders/logic-document';
import { regionLaneDocument } from '../../../support/builders/region-lane-document';
import { persistedNestedGridDocument } from '../../core/layout/nested-region-fixture';

describe('product node grouping', () => {
	it('creates a root group around root siblings', () => {
		const grouped = groupDocumentNodes(
			validLogicDocument(),
			{ id: 'root-group', label: 'Groupe' },
			new Set(['target', 'isolated']),
		);

		expect(grouped.groups).toContainEqual(
			expect.objectContaining({
				kind: EndpointKind.Group,
				id: 'root-group',
				label: 'Groupe',
			}),
		);
		expect(grouped.groups.find(({ id }) => id === 'root-group')).not.toHaveProperty('groupId');
		expect(
			grouped.nodes
				.filter(({ id }) => id === 'target' || id === 'isolated')
				.map(({ groupId }) => groupId),
		).toEqual(['root-group', 'root-group']);
	});

	it('transfers lane ownership between root groups and their members', () => {
		const source = explicitLaneLogicDocument();
		const grouped = groupDocumentNodes(
			source,
			{ id: 'lane-group', label: 'Lane group' },
			new Set(['target']),
		);
		expect(grouped.groups.find(({ id }) => id === 'lane-group')).toMatchObject({
			laneId: 'left',
		});
		expect(grouped.nodes.find(({ id }) => id === 'target')).not.toHaveProperty('laneId');
		const dissolved = dissolveDocumentGroup(grouped, 'lane-group');
		expect(dissolved.nodes.find(({ id }) => id === 'target')).toMatchObject({
			laneId: 'left',
		});
	});

	it('rejects grouping nodes from different lanes', () => {
		expect(() =>
			groupDocumentNodes(
				explicitLaneLogicDocument(),
				{ id: 'cross-lane', label: 'Cross lane' },
				new Set(['target', 'isolated']),
			),
		).toThrow('même voie');
	});

	it('moves a node into a group and restores the group lane when removed', () => {
		const source = explicitLaneLogicDocument();
		const added = changeDocumentMembership(source, 'orphan-group', new Set(['target']), true);
		expect(added.nodes.find(({ id }) => id === 'target')).toMatchObject({
			groupId: 'orphan-group',
		});
		expect(added.nodes.find(({ id }) => id === 'target')).not.toHaveProperty('laneId');
		const removed = changeDocumentMembership(added, 'orphan-group', new Set(['target']), false);
		expect(removed.nodes.find(({ id }) => id === 'target')).toMatchObject({
			laneId: 'right',
		});
	});

	it('keeps region ownership when grouping, moving and dissolving a root group', () => {
		const legacy = validLogicDocument();
		const source = {
			...legacy,
			persistenceFormat: REGION_PERSISTENCE_FORMAT,
			regionPresentation: {
				schemaVersion: REGION_PRESENTATION_SCHEMA,
				regions: [
					{
						id: 'zone',
						layoutOrder: orderKey('a0'),
						policy: LayoutPolicy.Layered,
					},
				],
			},
			nodes: legacy.nodes.map((node) => {
				if (node.id === 'target' || node.id === 'isolated') return { ...node, regionId: 'zone' };
				return node;
			}),
		};
		const grouped = groupDocumentNodes(
			source,
			{ id: 'region-group', label: 'Region group' },
			new Set(['target', 'isolated']),
		);
		expect(grouped.groups.find(({ id }) => id === 'region-group')).toMatchObject({
			regionId: 'zone',
		});
		expect(grouped.nodes.find(({ id }) => id === 'target')).not.toHaveProperty('regionId');
		const dissolved = dissolveDocumentGroup(grouped, 'region-group');
		expect(dissolved.nodes.find(({ id }) => id === 'target')).toMatchObject({
			regionId: 'zone',
		});
		const added = changeDocumentMembership(source, 'container', new Set(['target']), true);
		expect(added.nodes.find(({ id }) => id === 'target')).not.toHaveProperty('regionId');
		const removed = changeDocumentMembership(added, 'container', new Set(['target']), false);
		expect(removed.nodes.find(({ id }) => id === 'target')).not.toHaveProperty('regionId');
	});

	it('rejects a new root group that would cross regions', () => {
		const legacy = validLogicDocument();
		const source = {
			...legacy,
			persistenceFormat: REGION_PERSISTENCE_FORMAT,
			regionPresentation: {
				schemaVersion: REGION_PRESENTATION_SCHEMA,
				regions: [
					{
						id: 'zone',
						layoutOrder: orderKey('a0'),
						policy: LayoutPolicy.Layered,
					},
				],
			},
			nodes: legacy.nodes.map((node) => {
				if (node.id === 'target') return { ...node, regionId: 'zone' };
				return node;
			}),
		};
		expect(() =>
			groupDocumentNodes(
				source,
				{ id: 'cross-region', label: 'Cross region' },
				new Set(['target', 'isolated']),
			),
		).toThrow('même région');
	});

	it('transfers a leaf-local lane to a new group and restores it when membership ends', () => {
		const source = regionLaneDocument();
		const grouped = groupDocumentNodes(
			source,
			{ id: 'service-group', label: 'Service group' },
			new Set(['target']),
		);
		expect(grouped.groups.find(({ id }) => id === 'service-group')).toMatchObject({
			regionId: 'shared',
			laneId: 'service',
		});
		expect(grouped.nodes.find(({ id }) => id === 'target')).not.toHaveProperty('laneId');
		const restored = changeDocumentMembership(grouped, 'service-group', new Set(['target']), false);
		expect(restored.nodes.find(({ id }) => id === 'target')).toMatchObject({
			regionId: 'shared',
			laneId: 'service',
		});
	});

	it('rejects grouping root siblings from different local lanes', () => {
		const source = regionLaneDocument();
		const target = source.nodes.find(({ id }) => id === 'target');
		if (target === undefined) throw new Error('Missing target');
		const withNeighbor = {
			...source,
			nodes: [
				...source.nodes,
				{
					...target,
					id: 'sales-neighbor',
					laneId: 'sales',
					layoutOrder: orderKey('a9'),
				},
			],
		};
		expect(() =>
			groupDocumentNodes(
				withNeighbor,
				{ id: 'cross-local-lane', label: 'Cross lane' },
				new Set(['target', 'sales-neighbor']),
			),
		).toThrow('même voie');
	});

	it('rejects cross-lane grouping through the lower-level document operation', () => {
		const source = regionLaneDocument();
		const target = source.nodes.find(({ id }) => id === 'target');
		if (target === undefined) throw new Error('Missing target');
		const withNeighbor = {
			...source,
			nodes: [
				...source.nodes,
				{
					...target,
					id: 'sales-neighbor',
					laneId: 'sales',
					layoutOrder: orderKey('a9'),
				},
			],
		};
		expect(() =>
			groupDocumentNodes(
				withNeighbor,
				{ id: 'cross-local-lane', label: 'Cross lane' },
				new Set(['target', 'sales-neighbor']),
			),
		).toThrow('même voie');
	});

	it('rejects cross-cell grouping through the lower-level document operation', () => {
		expect(() =>
			groupDocumentNodes(
				persistedNestedGridDocument(),
				{ id: 'cross-cell', label: 'Cross cell' },
				new Set(['a-source', 'b']),
			),
		).toThrow('même région');
	});

	it('rejects membership changes with an unconfigured region assignment', () => {
		const legacy = validLogicDocument();
		const source = {
			...legacy,
			persistenceFormat: REGION_PERSISTENCE_FORMAT,
			nodes: legacy.nodes.map((node) => {
				if (node.id === 'target') return { ...node, regionId: 'missing' };
				return node;
			}),
		};
		expect(() => changeDocumentMembership(source, 'container', new Set(['target']), true)).toThrow(
			'présentation des régions est invalide',
		);
	});

	it('keeps cell ownership while grouping and ungrouping nodes in format 7', () => {
		const source = persistedNestedGridDocument();
		const grouped = groupDocumentNodes(
			source,
			{ id: 'cell-group', label: 'Cell group' },
			new Set(['a-source', 'a-target']),
		);
		expect(grouped.groups.find(({ id }) => id === 'cell-group')).toMatchObject({
			regionId: 'a',
		});
		expect(grouped.nodes.find(({ id }) => id === 'a-source')).not.toHaveProperty('regionId');
		const dissolved = dissolveDocumentGroup(grouped, 'cell-group');
		expect(dissolved.nodes.find(({ id }) => id === 'a-source')).toMatchObject({
			regionId: 'a',
		});
	});
});
