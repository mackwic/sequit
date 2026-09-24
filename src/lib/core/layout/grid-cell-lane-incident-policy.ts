import { compareCanonicalStrings } from '../canonical-string';
import {
	defined,
	EndpointKind,
	type GridLayoutCell,
	LaneOrientation,
	LayoutDirection,
	type LogicRelation,
} from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { RegionCompositionModel, RegionCompositionNode } from './region-composition-model';
import type { SharedLaneOutgoingIncident } from './shared-lane-incident-contract';

interface LaneCellIncidentInput {
	readonly graph: LogicGraph;
	readonly model: RegionCompositionModel;
	readonly gridId: string;
	readonly cell: GridLayoutCell;
	readonly crossings: readonly LogicRelation[];
}

function verticalParallel(
	graph: LogicGraph,
	grid: RegionCompositionNode,
	child: RegionCompositionNode,
): boolean {
	const gridDirection = grid.definition.layout?.direction ?? graph.document.layout.direction;
	const childDirection = child.definition.layout?.direction ?? graph.document.layout.direction;
	const vertical =
		gridDirection === LayoutDirection.TopToBottom && childDirection === LayoutDirection.TopToBottom;
	return (
		vertical && child.definition.lanePresentation?.laneOrientation === LaneOrientation.Parallel
	);
}

function rightRailCrossing(input: LaneCellIncidentInput, relation: LogicRelation): boolean {
	const { model, gridId, cell } = input;
	const grid = defined(defined(model.regionsById.get(gridId)).definition.grid);
	const targetCellId = model.leafByEndpointId.get(relation.to);
	const targetCell = grid.cells.find(({ regionId }) => regionId === targetCellId);
	const sourceHere = model.leafByEndpointId.get(relation.from) === cell.regionId;
	const rightTopCell = cell.row === 0 && cell.column === 1;
	const targetBelow = targetCell?.row === 1 && targetCell.column === 1;
	return sourceHere && rightTopCell && targetBelow;
}

function orderedLanes(input: LaneCellIncidentInput): readonly { readonly id: string }[] {
	const child = defined(input.model.regionsById.get(input.cell.regionId));
	const presentation = defined(child.definition.lanePresentation);
	return [...presentation.lanes].sort((left, right) =>
		compareCanonicalStrings(left.layoutOrder, right.layoutOrder),
	);
}

function laneSource(input: LaneCellIncidentInput, relation: LogicRelation): boolean {
	const { graph } = input;
	const source = defined(graph.endpointsById.get(relation.from));
	const lanes = orderedLanes(input);
	const ungroupedNode = source.kind === EndpointKind.Node && source.entity.groupId === undefined;
	const assignedLane = lanes.some(({ id }) => id === source.entity.laneId);
	return lanes.length === 2 && ungroupedNode && assignedLane;
}

function innerLanePassage(input: LaneCellIncidentInput, relation: LogicRelation): boolean {
	const { graph, model, cell } = input;
	const lanes = orderedLanes(input);
	const source = defined(graph.endpointsById.get(relation.from));
	if (source.entity.laneId !== defined(lanes[0]).id) return false;
	const local = defined(model.localRelationsByOwner.get(cell.regionId));
	if (local.length !== 1) return false;
	if (defined(local[0]).from !== relation.from) return false;
	const target = defined(graph.endpointsById.get(defined(local[0]).to));
	return target.entity.laneId === defined(lanes[1]).id;
}

/** The first lane crossing uses the exposed right lane and the grid's right rail. */
export function laneCellIncidentFailure(input: LaneCellIncidentInput): string | undefined {
	const { graph, model, gridId, cell, crossings } = input;
	const child = defined(model.regionsById.get(cell.regionId));
	const presentation = child.definition.lanePresentation;
	if (presentation === undefined) return undefined;
	const incidents = crossings.filter(
		({ from, to }) =>
			model.leafByEndpointId.get(from) === cell.regionId ||
			model.leafByEndpointId.get(to) === cell.regionId,
	);
	if (incidents.length === 0) return undefined;
	if (incidents.length > 1)
		return `Grid cell ${cell.regionId} with lanes accepts one inter-cell incident.`;
	const gridRegion = defined(model.regionsById.get(gridId));
	if (!verticalParallel(graph, gridRegion, child))
		return `Grid cell ${cell.regionId} with an inter-cell incident requires top-to-bottom parallel lanes.`;
	const relation = defined(incidents[0]);
	if (!rightRailCrossing(input, relation))
		return `Grid cell ${cell.regionId} with lanes requires an outgoing right-rail crossing to the cell below.`;
	if (!laneSource(input, relation))
		return `Grid cell ${cell.regionId} with lanes requires an ungrouped node in one of its lanes for an inter-cell incident.`;
	const source = defined(graph.endpointsById.get(relation.from));
	const outerLane = defined(orderedLanes(input)[1]);
	if (source.entity.laneId !== outerLane.id && !innerLanePassage(input, relation))
		return `Grid cell ${cell.regionId} requires one local passage from the incident node to its outer lane.`;
	return undefined;
}

/** The inner-lane case reserves a separate rightward corridor in its local solve. */
export function laneCellOutgoingContract(
	input: LaneCellIncidentInput,
): SharedLaneOutgoingIncident | undefined {
	const child = defined(input.model.regionsById.get(input.cell.regionId));
	if (child.definition.lanePresentation === undefined) return undefined;
	const incidents = input.crossings.filter(
		({ from }) => input.model.leafByEndpointId.get(from) === input.cell.regionId,
	);
	if (incidents.length !== 1) return undefined;
	const relation = defined(incidents[0]);
	if (!innerLanePassage(input, relation)) return undefined;
	return { relationId: relation.id, endpointId: relation.from, side: 1 };
}
