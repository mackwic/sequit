import type { LogicDocument } from '../../../lib/core/document/logic-document';
import { createGraph, type LogicGraph } from '../../../lib/core/graph/create-graph';
import {
	topologicallyRank,
	type TopologicalRanks,
} from '../../../lib/core/graph/topological-ranks';
import type { LayoutMeasurements, LayoutResult } from '../../../lib/core/layout/layout-types';
import {
	type CanvasMeasurementModel,
	type CanvasModel,
	type CanvasNavigationProjection,
	createCanvasMeasurementModel,
	createCanvasModel,
} from '../ui/canvas/canvas-model';
import { layoutMeasurementSignature } from '../ui/canvas/measure-canvas';
import { layoutGraph } from './layout-graph';

/** Only topology/order/direction affect graph preparation. Text is measured separately. */
function topologySignature(document: LogicDocument): string {
	return JSON.stringify([
		document.layout,
		document.nodes.map(({ id, groupId, layoutOrder }) => [id, groupId, layoutOrder]),
		document.groups.map(({ id, groupId, layoutOrder }) => [id, groupId, layoutOrder]),
		document.junctions.map(({ id, groupId, layoutOrder, operator }) => [
			id,
			groupId,
			layoutOrder,
			operator,
		]),
		document.relations,
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

	constructor(document: LogicDocument, graph?: LogicGraph) {
		this.#document = document;
		this.#topology = this.prepare(document, graph);
		this.#measurementModel = createCanvasMeasurementModel(document);
		this.#measurementSignature = JSON.stringify(this.#measurementModel);
	}

	get measurementModel(): CanvasMeasurementModel {
		return this.#measurementModel;
	}

	update(document: LogicDocument): boolean {
		const signature = topologySignature(document);
		let topology = this.#topology;
		if (signature !== topology.signature) topology = this.prepare(document);
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
			layout = {
				topology,
				signature,
				result: layoutGraph(topology.graph, topology.ranks, measurements),
			};
			this.#layout = layout;
		}
		try {
			let navigation: CanvasNavigationProjection = { document, ranks: topology.ranks };
			if (relationProjections !== undefined) navigation = { ...navigation, relationProjections };
			const canvas = createCanvasModel(measurement, await layout.result, navigation);
			return reuseRelations(layout, canvas);
		} catch (error) {
			if (this.#layout === layout) this.#layout = undefined;
			throw error;
		}
	}

	private prepare(document: LogicDocument, graph?: LogicGraph): PreparedTopology {
		let next = graph;
		if (next === undefined) {
			const result = createGraph(document);
			if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join('; '));
			next = result.value;
		}
		return { signature: topologySignature(document), graph: next, ranks: topologicallyRank(next) };
	}
}
