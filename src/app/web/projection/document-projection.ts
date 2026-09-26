import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
import type {
	GridLayoutPresentation,
	LogicDocument,
	RegionLanePresentation,
} from '../../../lib/core/document/logic-document';
import { createGraph, type LogicGraph } from '../../../lib/core/graph/create-graph';
import {
	topologicallyRank,
	type TopologicalRanks,
} from '../../../lib/core/graph/topological-ranks';
import type { LayoutMeasurements, LayoutResult } from '../../../lib/core/layout/layout-types';
import { RegionLocalLayoutCache } from '../../../lib/core/layout/regions/model/region-local-cache';
import {
	type CanvasMeasurementModel,
	type CanvasModel,
	type CanvasNavigationProjection,
	createCanvasMeasurementModel,
	createCanvasModel,
} from '../ui/canvas/canvas-model';
import { layoutMeasurementSignature } from '../ui/canvas/measure-canvas';
import { layoutGraph, layoutGraphForProjection } from './layout-graph';
import { partialRegionFailure } from './partial-region-layout';

function regionLaneSignature(presentation: RegionLanePresentation | undefined): unknown {
	if (presentation === undefined) return null;
	return [
		presentation.laneOrientation,
		presentation.growth,
		[...presentation.lanes]
			.sort((left, right) => compareCanonicalStrings(left.id, right.id))
			.map(({ id, label, layoutOrder }) => [id, label, layoutOrder]),
	];
}

function gridSignature(grid: GridLayoutPresentation | undefined): unknown {
	if (grid === undefined) return null;
	return [
		grid.minimumColumnWidths,
		grid.minimumRowHeights,
		[...grid.cells]
			.sort((left, right) => compareCanonicalStrings(left.regionId, right.regionId))
			.map(({ regionId, row, column }) => [regionId, row, column]),
	];
}

/** Only topology/order/direction affect graph preparation. Text is measured separately. */
function topologySignature(document: LogicDocument): string {
	const byId = <T extends { readonly id: string }>(items: readonly T[]): T[] =>
		[...items].sort((left, right) => compareCanonicalStrings(left.id, right.id));
	let presentation: unknown = null;
	if (document.presentation !== undefined)
		presentation = [
			[document.presentation.schemaVersion, document.presentation.policy],
			[document.presentation.laneOrientation, document.presentation.growth],
			byId(document.presentation.lanes).map(({ id, label, layoutOrder }) => [
				id,
				label,
				layoutOrder,
			]),
		];
	let regionPresentation: unknown = null;
	if (document.regionPresentation !== undefined) {
		regionPresentation = [
			document.regionPresentation.schemaVersion,
			byId(document.regionPresentation.regions).map(
				({ id, parentId, layoutOrder, policy, lanePresentation, grid }) => [
					id,
					parentId,
					layoutOrder,
					policy,
					regionLaneSignature(lanePresentation),
					gridSignature(grid),
				],
			),
			gridSignature(document.regionPresentation.grid),
		];
	}
	return JSON.stringify([
		[document.layout.direction, document.layout.bias],
		presentation,
		regionPresentation,
		byId(document.nodes).map(({ id, groupId, laneId, regionId, layoutOrder }) => [
			id,
			groupId,
			laneId,
			regionId,
			layoutOrder,
		]),
		byId(document.groups).map(({ id, groupId, laneId, regionId, layoutOrder }) => [
			id,
			groupId,
			laneId,
			regionId,
			layoutOrder,
		]),
		byId(document.junctions).map(({ id, groupId, laneId, regionId, layoutOrder, operator }) => [
			id,
			groupId,
			laneId,
			regionId,
			layoutOrder,
			operator,
		]),
		byId(document.relations).map(({ id, from, to }) => [id, from, to]),
	]);
}

interface PreparedTopology {
	readonly signature: string;
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
}

interface MeasuredLayout {
	readonly topology: PreparedTopology;
	readonly signature: string;
	readonly result: Promise<LayoutResult>;
	relations?: {
		readonly provenance: string;
		readonly value: CanvasModel['relations'];
	};
}

/** Preserve the rendering dependency when only node content changed; provenance remains current. */
function reuseRelations(layout: MeasuredLayout, canvas: CanvasModel): CanvasModel {
	// One measured layout fixes relation order, endpoints and point identities. Only metadata can vary.
	const provenance = JSON.stringify(
		canvas.relations.map(({ sourceRelationIds, canChangeFrom, canChangeTo }) => [
			sourceRelationIds,
			canChangeFrom,
			canChangeTo,
		]),
	);
	const previous = layout.relations;
	if (previous?.provenance === provenance) return { ...canvas, relations: previous.value };
	layout.relations = { provenance, value: canvas.relations };
	return canvas;
}

/** Per opened document: reuse immutable preparation and geometry, never mutable workspaces. */
export class DocumentProjection {
	#document: LogicDocument;
	#topology: PreparedTopology;
	#measurementModel: CanvasMeasurementModel;
	#measurementSignature: string;
	#layout: MeasuredLayout | undefined;
	readonly #nestedRegionCache = new RegionLocalLayoutCache();

	constructor(document: LogicDocument, graph?: LogicGraph) {
		this.#document = document;
		this.#topology = this.prepare(document, graph);
		this.#measurementModel = createCanvasMeasurementModel(document);
		this.#measurementSignature = JSON.stringify(this.#measurementModel);
	}

	get measurementModel(): CanvasMeasurementModel {
		return this.#measurementModel;
	}

	update(document: LogicDocument, graph?: LogicGraph): boolean {
		const signature = topologySignature(document);
		let topology = this.#topology;
		if (signature !== topology.signature) topology = this.prepare(document, graph);
		const measurement = createCanvasMeasurementModel(document);
		const measurementSignature = JSON.stringify(measurement);
		const changed =
			topology !== this.#topology || measurementSignature !== this.#measurementSignature;
		// Commit together: a failed projection keeps its preceding valid state usable.
		this.#document = document;
		this.#topology = topology;
		if (measurementSignature !== this.#measurementSignature) {
			this.#measurementModel = measurement;
			this.#measurementSignature = measurementSignature;
		}
		return changed;
	}

	async createCanvasModel(
		measurements: LayoutMeasurements,
		relationProjections?: CanvasNavigationProjection['relationProjections'],
	): Promise<CanvasModel> {
		const topology = this.#topology;
		const document = this.#document;
		const measurement = this.#measurementModel;
		const signature = layoutMeasurementSignature(measurements);
		let layout = this.#layout;
		if (layout?.topology !== topology || layout.signature !== signature) {
			let result: Promise<LayoutResult>;
			if (topology.graph.document.regionPresentation === undefined)
				result = layoutGraph(topology.graph, topology.ranks, measurements);
			else
				result = layoutGraphForProjection(
					topology.graph,
					topology.ranks,
					measurements,
					this.#nestedRegionCache,
				);
			layout = {
				topology,
				signature,
				result,
			};
			this.#layout = layout;
		}
		try {
			let navigation: CanvasNavigationProjection = {
				document,
				ranks: topology.ranks,
			};
			if (relationProjections !== undefined) navigation = { ...navigation, relationProjections };
			const canvas = createCanvasModel(measurement, await layout.result, navigation);
			return reuseRelations(layout, canvas);
		} catch (error) {
			if (this.#layout === layout) this.#layout = undefined;
			throw partialRegionFailure(
				error,
				{ ...topology.graph, document },
				measurements,
				this.#nestedRegionCache,
			);
		}
	}

	private prepare(document: LogicDocument, graph?: LogicGraph): PreparedTopology {
		let next = graph;
		if (next === undefined) {
			const result = createGraph(document);
			if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join('; '));
			next = result.value;
		}
		return {
			signature: topologySignature(document),
			graph: next,
			ranks: topologicallyRank(next),
		};
	}
}
