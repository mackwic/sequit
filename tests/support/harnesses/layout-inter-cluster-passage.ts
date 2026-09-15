import { layoutGraph } from '../../../src/app/web/projection/layout-graph';
import {
	defined,
	EndpointKind,
	type LayoutBias,
	layoutConfiguration,
	type LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../src/lib/core/document/order-key';
import { prepareLayoutDocument } from './layout';
import { defaultBiasFor } from './visual-directions';
import { VisualLayout } from './visual-layout';

export async function layoutInterClusterPassage(
	direction: LayoutDirection,
	bias: LayoutBias = defaultBiasFor(direction),
): Promise<VisualLayout> {
	const groupId = 'use-cases';
	const document: LogicDocument = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'inter-cluster-passage',
		title: 'Une relation longue utilise le corridor entre deux clusters',
		layout: defined(layoutConfiguration(direction, bias)),
		natures: [
			{ id: 'need', label: 'Need', color: '#e8c441' },
			{ id: 'want', label: 'Want', color: '#e389c4' },
			{ id: 'solution', label: 'Solution', color: '#9189e8' },
			{ id: 'note', label: 'Note', color: '#d8cd72' },
		],
		groups: [
			{
				id: groupId,
				kind: EndpointKind.Group,
				label: 'Use cases',
				layoutOrder: orderKey('a0'),
			},
		],
		nodes: [
			{
				id: 'isolated-partner-edits',
				kind: EndpointKind.Node,
				natureId: 'need',
				groupId,
				markdown: 'Keep Partners edits isolated',
				layoutOrder: orderKey('a1'),
			},
			{
				id: 'lossless-docx-import',
				kind: EndpointKind.Node,
				natureId: 'want',
				groupId,
				markdown: 'Import docx without losing history or content',
				layoutOrder: orderKey('a2'),
			},
			{
				id: 'docx-oriented-platform',
				kind: EndpointKind.Node,
				natureId: 'solution',
				groupId,
				markdown: 'Docx-oriented document platform',
				layoutOrder: orderKey('a3'),
			},
			{
				id: 'traceable-edits',
				kind: EndpointKind.Node,
				natureId: 'need',
				groupId,
				markdown: 'All edits need to be traceable',
				layoutOrder: orderKey('a4'),
			},
			{
				id: 'word-alcoa-question',
				kind: EndpointKind.Node,
				natureId: 'note',
				groupId,
				markdown: 'Does Word provide the required guarantees?',
				layoutOrder: orderKey('a5'),
			},
			{
				id: 'compliance-review',
				kind: EndpointKind.Node,
				natureId: 'solution',
				groupId,
				markdown: 'Review the available remediation',
				layoutOrder: orderKey('a6'),
			},
		],
		junctions: [],
		relations: [
			{
				id: 'want-to-need',
				from: 'lossless-docx-import',
				to: 'isolated-partner-edits',
			},
			{
				id: 'solution-to-want',
				from: 'docx-oriented-platform',
				to: 'lossless-docx-import',
			},
			{
				id: 'solution-to-need',
				from: 'docx-oriented-platform',
				to: 'isolated-partner-edits',
			},
			{
				id: 'question-to-traceable',
				from: 'word-alcoa-question',
				to: 'traceable-edits',
			},
			{
				id: 'review-to-traceable',
				from: 'compliance-review',
				to: 'traceable-edits',
			},
		],
	};
	const prepared = prepareLayoutDocument(document, {
		groups: {
			[groupId]: {
				minimumWidth: 160,
				minimumHeight: 72,
				headerHeight: 36,
				padding: 40,
			},
		},
	});
	const result = await layoutGraph(prepared.graph, prepared.ranks, prepared.measurements, {
		inspectRouting: true,
	});
	return new VisualLayout(result, prepared.ranks.byEndpointId, direction, undefined, document);
}
