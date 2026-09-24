import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	LayoutFailureReasonCode,
	LayoutProjectionError,
} from '../../../../src/app/web/projection/layout-diagnostic';
import {
	partialRegionFailure,
	partialRegionPreviews,
	RegionPreviewFailureCode,
	RegionPreviewKind,
	RegionPreviewScope,
} from '../../../../src/app/web/projection/partial-region-layout';
import { createSharedCanvasProjection } from '../../../../src/app/web/projection/shared-canvas-projection';
import { SourceDocumentProjectionError } from '../../../../src/app/web/projection/source-document-diagnostic';
import {
	defined,
	EndpointKind,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { NestedRegionLocalLayoutCache } from '../../../../src/lib/core/layout/nested-region-local-cache';
import {
	readSourceDocumentState,
	SourceDocumentStateKind,
} from '../../../../src/lib/infrastructure/collaboration/source-document-state';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	createYjsEntityMap,
	YjsCollection,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';
import { layoutMeasurementsForCanvas } from '../../../support/builders/layout-measurements';
import {
	regionLanePartialDocument,
	regionLanePartialSubtreeDocument,
} from '../../../support/builders/region-lane-document';

function graphFor(document: LogicDocument) {
	const graph = createGraph(document);
	if (!graph.ok) throw new Error('Expected a valid graph');
	return graph.value;
}

async function layoutFailure(document: LogicDocument): Promise<LayoutProjectionError> {
	return layoutFailureFromProjection(createSharedCanvasProjection(document));
}

describe('partial region layout projection', () => {
	it('keeps a source-valid persisted ordinary leaf when its sibling lane layout is unresolved', async () => {
		const document = regionLanePartialDocument(true);
		expect(validateLogicDocument(document)).toMatchObject({ ok: true });
		const parsed = parseSequitToml(serializeSequitToml(document));
		expect(parsed).toMatchObject({ ok: true });
		if (!parsed.ok) throw new Error('Expected a persisted region document');
		const failure = await layoutFailure(parsed.value);
		expect(failure.diagnostic.reason.code).toBe(LayoutFailureReasonCode.UnknownRegionLayout);
		expect(failure.regions).toMatchObject([
			{
				kind: 'diagnostic',
				regionId: 'shared',
				code: RegionPreviewFailureCode.Unknown,
			},
			{
				kind: 'ready',
				regionId: 'ordinary',
				canvas: { relations: [], nodes: [{ id: 'neighbor' }] },
			},
		]);
		expect(failure.regions?.find(({ regionId }) => regionId === 'ordinary')).toMatchObject({
			canvas: { nodes: [{ markdown: 'Neighbor\n' }] },
		});
	});

	it('publishes a complete closed branch and its internal route beside a failed sibling', async () => {
		const source = regionLanePartialSubtreeDocument(true);
		expect(validateLogicDocument(source)).toMatchObject({ ok: true });
		const parsed = parseSequitToml(serializeSequitToml(source));
		expect(parsed).toMatchObject({ ok: true });
		if (!parsed.ok) throw new Error('Expected persisted closed subtree');
		const failure = await layoutFailure(parsed.value);
		expect(failure.diagnostic.reason.code).toBe(LayoutFailureReasonCode.UnknownRegionLayout);
		const branch = failure.regions?.find(({ regionId }) => regionId === 'branch');
		expect(branch).toMatchObject({
			kind: RegionPreviewKind.Ready,
			regionId: 'branch',
			scope: RegionPreviewScope.ClosedSubtree,
		});
		if (branch?.kind !== RegionPreviewKind.Ready)
			throw new Error('Expected a selected closed branch');
		expect(branch.canvas.nodes.map(({ id }) => id).sort()).toEqual(['mate-node', 'neighbor']);
		expect(branch.canvas.regions?.map(({ id }) => id).sort()).toEqual(['mate', 'ordinary']);
		expect(branch.canvas.relations).toMatchObject([
			{ id: 'inside-branch', from: 'neighbor', to: 'mate-node' },
		]);
		expect(branch.canvas.relations[0]?.points.length).toBeGreaterThan(1);
		expect(failure.regions?.map(({ regionId }) => regionId)).toEqual(['branch', 'shared']);
	});

	it('excludes an open branch instead of presenting its internal relation as complete', () => {
		const source = regionLanePartialSubtreeDocument(true);
		const document = {
			...source,
			relations: [...source.relations, { id: 'leaves-branch', from: 'mate-node', to: 'delivery' }],
		};
		expect(validateLogicDocument(document)).toMatchObject({ ok: true });
		const projection = createSharedCanvasProjection(document);
		const previews = partialRegionPreviews(
			graphFor(document),
			layoutMeasurementsForCanvas(projection.measurementModel),
			new NestedRegionLocalLayoutCache(),
		);
		expect(previews.find(({ regionId }) => regionId === 'branch')).toBeUndefined();
		expect(previews.some(({ kind }) => kind === RegionPreviewKind.Ready)).toBe(false);
	});

	it('falls back to healthy descendants when a closed branch cannot be selected', () => {
		const source = regionLanePartialSubtreeDocument(true);
		const document: LogicDocument = {
			...source,
			nodes: source.nodes.filter(({ id }) => id !== 'mate-node'),
			relations: source.relations.filter(({ id }) => id !== 'inside-branch'),
		};
		expect(validateLogicDocument(document)).toMatchObject({ ok: true });
		const projection = createSharedCanvasProjection(document);
		const previews = partialRegionPreviews(
			graphFor(document),
			layoutMeasurementsForCanvas(projection.measurementModel),
			new NestedRegionLocalLayoutCache(),
		);
		expect(previews.find(({ regionId }) => regionId === 'branch')).toBeUndefined();
		expect(previews.find(({ regionId }) => regionId === 'ordinary')).toMatchObject({
			kind: RegionPreviewKind.Ready,
			scope: RegionPreviewScope.Leaf,
			canvas: { nodes: [{ id: 'neighbor' }], relations: [] },
		});
	});

	it('publishes no partial canvas when a source-valid endpoint is assigned to an inner region', () => {
		const source = regionLanePartialSubtreeDocument(true);
		const document: LogicDocument = {
			...source,
			nodes: source.nodes.map((node) => {
				if (node.id !== 'mate-node') return node;
				return { ...node, regionId: 'branch' };
			}),
		};
		expect(validateLogicDocument(document)).toMatchObject({ ok: true });
		const graph = graphFor(document);
		const projection = createSharedCanvasProjection(document);
		const measurements = layoutMeasurementsForCanvas(projection.measurementModel);
		const incremental = partialRegionPreviews(
			graph,
			measurements,
			new NestedRegionLocalLayoutCache(),
		);
		const cold = partialRegionPreviews(
			graphFor(document),
			measurements,
			new NestedRegionLocalLayoutCache(),
		);
		expect(incremental).toEqual(cold);
		expect(incremental).toEqual([]);
	});

	it('keeps an independent sibling diagnostic when a closed branch lacks measurements', () => {
		const document = regionLanePartialSubtreeDocument(true);
		const projection = createSharedCanvasProjection(document);
		const measured = layoutMeasurementsForCanvas(projection.measurementModel);
		const nodes = new Map(measured.nodes);
		nodes.delete('neighbor');
		const previews = partialRegionPreviews(
			graphFor(document),
			{ ...measured, nodes },
			new NestedRegionLocalLayoutCache(),
		);
		expect(previews).toMatchObject([
			{
				kind: RegionPreviewKind.Diagnostic,
				regionId: 'shared',
				code: RegionPreviewFailureCode.Unknown,
			},
		]);
	});

	it('reuses a closed branch without leaking old source content after the sibling fails', async () => {
		const selected = regionLanePartialSubtreeDocument(false);
		const unresolved = regionLanePartialSubtreeDocument(true);
		const projection = createSharedCanvasProjection(selected);
		await projection.createCanvasModel(layoutMeasurementsForCanvas(projection.measurementModel));
		projection.update(unresolved);
		const incremental = await layoutFailureFromProjection(projection);
		const cold = await layoutFailure(unresolved);
		expect(incremental.regions).toEqual(cold.regions);
		const edited: LogicDocument = {
			...unresolved,
			nodes: unresolved.nodes.map((node) => {
				if (node.id !== 'mate-node') return node;
				return { ...node, markdown: 'Current mate\n' };
			}),
		};
		projection.update(edited);
		const current = await layoutFailureFromProjection(projection);
		expect(current.regions).toEqual((await layoutFailure(edited)).regions);
		expect(current.regions?.find(({ regionId }) => regionId === 'branch')).toMatchObject({
			canvas: { nodes: [{ id: 'neighbor' }, { id: 'mate-node', markdown: 'Current mate\n' }] },
		});
	});

	it('preserves a closed branch route under collection permutations', async () => {
		const source = regionLanePartialSubtreeDocument(true);
		const presentation = defined(source.regionPresentation);
		const permuted: LogicDocument = {
			...source,
			nodes: [...source.nodes].reverse(),
			relations: [...source.relations].reverse(),
			regionPresentation: {
				...presentation,
				regions: [...presentation.regions].reverse(),
			},
		};
		const original = (await layoutFailure(source)).regions?.find(
			({ regionId }) => regionId === 'branch',
		);
		const alternate = (await layoutFailure(permuted)).regions?.find(
			({ regionId }) => regionId === 'branch',
		);
		expect(original?.kind).toBe(RegionPreviewKind.Ready);
		expect(alternate?.kind).toBe(RegionPreviewKind.Ready);
		if (original?.kind !== RegionPreviewKind.Ready) return;
		if (alternate?.kind !== RegionPreviewKind.Ready) return;
		expect(alternate.canvas.relations).toEqual(original.canvas.relations);
		expect(new Map(alternate.canvas.nodes.map(({ id, bounds }) => [id, bounds]))).toEqual(
			new Map(original.canvas.nodes.map(({ id, bounds }) => [id, bounds])),
		);
		expect(new Map(alternate.canvas.regions?.map(({ id, bounds }) => [id, bounds]))).toEqual(
			new Map(original.canvas.regions?.map(({ id, bounds }) => [id, bounds])),
		);
	});

	it('matches cold previews after a local edit and canonical collection permutations', async () => {
		const source = regionLanePartialDocument(true);
		const projection = createSharedCanvasProjection(regionLanePartialDocument(false));
		const sizes = layoutMeasurementsForCanvas(projection.measurementModel);
		await projection.createCanvasModel(sizes);
		projection.update(source);
		const incremental = await layoutFailureFromProjection(projection);
		const cold = await layoutFailure(source);
		expect(incremental.regions).toEqual(cold.regions);
		const presentation = defined(source.regionPresentation);
		const permuted: LogicDocument = {
			...source,
			nodes: [...source.nodes].reverse(),
			relations: [...source.relations].reverse(),
			regionPresentation: {
				...presentation,
				regions: [...presentation.regions].reverse(),
			},
		};
		const alternate = await layoutFailure(permuted);
		expect(alternate.regions?.map(({ regionId, kind }) => [regionId, kind])).toEqual(
			cold.regions?.map(({ regionId, kind }) => [regionId, kind]),
		);
		const originalOrdinary = cold.regions?.find(({ regionId }) => regionId === 'ordinary');
		const alternateOrdinary = alternate.regions?.find(({ regionId }) => regionId === 'ordinary');
		expect(alternateOrdinary).toEqual(originalOrdinary);
	});

	it('uses current source content when graph topology stays cached after a failed layout', async () => {
		const source = regionLanePartialDocument(true);
		const projection = createSharedCanvasProjection(source);
		await layoutFailureFromProjection(projection);
		const edited: LogicDocument = {
			...source,
			nodes: source.nodes.map((node) => {
				if (node.id !== 'neighbor') return node;
				return { ...node, markdown: 'Current neighbor\n' };
			}),
		};
		projection.update(edited);
		const incremental = await layoutFailureFromProjection(projection);
		const cold = await layoutFailure(edited);
		expect(incremental.regions).toEqual(cold.regions);
		expect(incremental.regions?.find(({ regionId }) => regionId === 'ordinary')).toMatchObject({
			canvas: { nodes: [{ markdown: 'Current neighbor\n' }] },
		});
	});

	it('localizes unsupported and missing-measurement leaves without masking the root failure', async () => {
		const source = regionLanePartialDocument(false);
		const group = {
			kind: EndpointKind.Group,
			id: 'shared-group',
			label: 'Shared group',
			regionId: 'shared',
			laneId: 'sales',
			layoutOrder: orderKey('a5'),
		} satisfies LogicDocument['groups'][number];
		const grouped: LogicDocument = {
			...source,
			groups: [group],
			nodes: source.nodes.map((node) => {
				if (node.id !== 'request') return node;
				const member = { ...node, groupId: group.id };
				delete member.regionId;
				delete member.laneId;
				return member;
			}),
		};
		expect(validateLogicDocument(grouped)).toMatchObject({ ok: true });
		const groupedFailure = await layoutFailure(grouped);
		expect(groupedFailure.diagnostic.reason.code).toBe(
			LayoutFailureReasonCode.UnsupportedRegionLayout,
		);
		const groupedShared = groupedFailure.regions?.find(({ regionId }) => regionId === 'shared');
		expect(groupedShared).toMatchObject({
			kind: 'diagnostic',
			regionId: 'shared',
			code: RegionPreviewFailureCode.Unsupported,
			endpointIds: ['delivery', 'request', 'shared-group'],
			relationIds: ['first-handoff'],
		});
		if (groupedShared?.kind === RegionPreviewKind.Diagnostic)
			expect(groupedShared.message).toContain('pas encore prise en charge');
		const projection = createSharedCanvasProjection(regionLanePartialDocument(true));
		const measured = layoutMeasurementsForCanvas(projection.measurementModel);
		const nodes = new Map(measured.nodes);
		nodes.delete('neighbor');
		const sizes = { ...measured, nodes };
		let failure: LayoutProjectionError | undefined;
		try {
			await projection.createCanvasModel(sizes);
		} catch (error) {
			if (error instanceof LayoutProjectionError) failure = error;
		}
		expect(failure?.diagnostic.reason.code).toBe(LayoutFailureReasonCode.UnknownRegionLayout);
		const missingOrdinary = failure?.regions?.find(({ regionId }) => regionId === 'ordinary');
		expect(missingOrdinary).toMatchObject({
			kind: 'diagnostic',
			regionId: 'ordinary',
			code: RegionPreviewFailureCode.CalculationFailed,
			endpointIds: ['neighbor'],
			relationIds: [],
		});
		if (missingOrdinary?.kind === RegionPreviewKind.Diagnostic)
			expect(missingOrdinary.message).toContain('calcul local');
	});

	it('keeps only the root diagnostic when every leaf is touched by an inter-region incident', async () => {
		const source = regionLanePartialDocument(true);
		const document = {
			...source,
			relations: [...source.relations, { id: 'external', from: 'neighbor', to: 'delivery' }],
		};
		expect(validateLogicDocument(document)).toMatchObject({ ok: true });
		const projection = createSharedCanvasProjection(document);
		const regions = partialRegionPreviews(
			graphFor(document),
			layoutMeasurementsForCanvas(projection.measurementModel),
			new NestedRegionLocalLayoutCache(),
		);
		expect(regions).toEqual([]);
		const failure = await layoutFailureFromProjection(projection);
		expect(failure.diagnostic.reason.code).toBe(LayoutFailureReasonCode.UnknownRegionLayout);
		expect(failure.regions).toBeUndefined();
		const ordinaryFailure = new Error('Unrelated failure');
		expect(
			partialRegionFailure(
				ordinaryFailure,
				graphFor(document),
				layoutMeasurementsForCanvas(projection.measurementModel),
				new NestedRegionLocalLayoutCache(),
			),
		).toBe(ordinaryFailure);
	});

	it('gives an invalid current source priority over otherwise available local previews', async () => {
		const source = regionLanePartialDocument(true);
		const projection = createSharedCanvasProjection(source);
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, source);
		ydoc
			.getMap<Y.Map<unknown>>(YjsCollection.Relations)
			.set('dangling', createYjsEntityMap({ from: 'neighbor', to: 'missing' }));
		const state = readSourceDocumentState(ydoc, 2);
		ydoc.destroy();
		expect(state.kind).toBe(SourceDocumentStateKind.Invalid);
		if (state.kind !== SourceDocumentStateKind.Invalid)
			throw new Error('Expected an invalid current source');
		projection.updateSourceState(state);
		await expect(
			projection.createCanvasModel(layoutMeasurementsForCanvas(projection.measurementModel)),
		).rejects.toBeInstanceOf(SourceDocumentProjectionError);
	});
});

async function layoutFailureFromProjection(
	projection: ReturnType<typeof createSharedCanvasProjection>,
): Promise<LayoutProjectionError> {
	try {
		await projection.createCanvasModel(layoutMeasurementsForCanvas(projection.measurementModel));
	} catch (error) {
		if (error instanceof LayoutProjectionError) return error;
		throw error;
	}
	throw new Error('Expected a layout failure');
}
