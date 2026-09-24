import {
	defined,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_LANE_PRESENTATION_SCHEMA,
} from '../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../src/lib/core/document/order-key';
import { validLogicDocument } from './logic-document';

/** One lane-bearing leaf beside an ordinary leaf, with group inheritance. */
export function regionLaneDocument(): LogicDocument {
	const source = validLogicDocument();
	return {
		...source,
		persistenceFormat: REGION_LANE_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_LANE_PRESENTATION_SCHEMA,
			regions: [
				{
					id: 'shared',
					layoutOrder: orderKey('a0'),
					policy: LayoutPolicy.Layered,
					lanePresentation: {
						laneOrientation: LaneOrientation.Parallel,
						growth: LaneGrowth.Auto,
						lanes: [
							{ id: 'sales', label: 'Sales', layoutOrder: orderKey('a0') },
							{ id: 'service', label: 'Service', layoutOrder: orderKey('a1') },
						],
					},
				},
				{
					id: 'ordinary',
					layoutOrder: orderKey('a1'),
					policy: LayoutPolicy.Layered,
				},
			],
		},
		groups: source.groups.map((group) => {
			if (group.id === 'container') return { ...group, regionId: 'shared', laneId: 'sales' };
			return { ...group, regionId: 'ordinary' };
		}),
		nodes: source.nodes.map((node) => {
			if (node.id === 'target') return { ...node, regionId: 'shared', laneId: 'service' };
			if (node.id === 'isolated') return { ...node, regionId: 'ordinary' };
			return node;
		}),
	};
}

/** Root lanes continue to serve ordinary leaves beside the leaf-local contract. */
export function regionLaneDocumentWithRootLanes(): LogicDocument {
	const source = regionLaneDocument();
	return {
		...source,
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: [
				{ id: 'root-left', label: 'Root left', layoutOrder: orderKey('a0') },
				{ id: 'root-right', label: 'Root right', layoutOrder: orderKey('a1') },
			],
		},
		groups: source.groups.map((group) => {
			if (group.id === 'container') return group;
			return { ...group, laneId: 'root-left' };
		}),
		nodes: source.nodes.map((node) => {
			if (node.id !== 'isolated') return node;
			return { ...node, laneId: 'root-right' };
		}),
	};
}

/** A persisted, source-valid local lane failure beside an incident-free ordinary leaf. */
export function regionLanePartialDocument(unresolved: boolean): LogicDocument {
	const source = regionLaneDocument();
	const template = defined(source.nodes.find(({ id }) => id === 'target'));
	const isolated = defined(source.nodes.find(({ id }) => id === 'isolated'));
	const request = {
		...template,
		id: 'request',
		markdown: 'Request\n',
		laneId: 'sales',
		layoutOrder: orderKey('a0'),
	};
	const delivery = {
		...template,
		id: 'delivery',
		markdown: 'Delivery\n',
		layoutOrder: orderKey('a1'),
	};
	const neighbor = {
		...isolated,
		id: 'neighbor',
		markdown: 'Neighbor\n',
		layoutOrder: orderKey('a2'),
	};
	const nodes = [request, delivery, neighbor];
	const relations = [{ id: 'first-handoff', from: 'request', to: 'delivery' }];
	if (unresolved) {
		nodes.push({
			...request,
			id: 'second-request',
			markdown: 'Second request\n',
			layoutOrder: orderKey('a4'),
		});
		relations.push({
			id: 'within-sales',
			from: 'request',
			to: 'second-request',
		});
		relations.push({
			id: 'second-handoff',
			from: 'second-request',
			to: 'delivery',
		});
	}
	return {
		...source,
		id: 'partial-region-lane',
		title: 'Partial region lane',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		groups: [],
		junctions: [],
		nodes,
		relations,
	};
}

/** A closed two-leaf branch remains independently solvable beside an unresolved lane leaf. */
export function regionLanePartialSubtreeDocument(unresolved: boolean): LogicDocument {
	const source = regionLanePartialDocument(unresolved);
	const presentation = defined(source.regionPresentation);
	const shared = defined(presentation.regions.find(({ id }) => id === 'shared'));
	const ordinary = defined(presentation.regions.find(({ id }) => id === 'ordinary'));
	const neighbor = defined(source.nodes.find(({ id }) => id === 'neighbor'));
	return {
		...source,
		regionPresentation: {
			...presentation,
			regions: [
				{ id: 'branch', layoutOrder: orderKey('a0'), policy: LayoutPolicy.Layered },
				{ ...ordinary, parentId: 'branch', layoutOrder: orderKey('a0') },
				{ ...ordinary, id: 'mate', parentId: 'branch', layoutOrder: orderKey('a1') },
				{ ...shared, layoutOrder: orderKey('a1') },
			],
		},
		nodes: [
			...source.nodes,
			{
				...neighbor,
				id: 'mate-node',
				markdown: 'Mate\n',
				regionId: 'mate',
				layoutOrder: orderKey('a5'),
			},
		],
		relations: [...source.relations, { id: 'inside-branch', from: 'neighbor', to: 'mate-node' }],
	};
}
