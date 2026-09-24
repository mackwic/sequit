import { layoutDocument } from '../../../../../tests/support/harnesses/layout';
import { VisualLayout } from '../../../../../tests/support/harnesses/visual-layout';
import { projectCollapsedDocument } from '../../../../lib/core/document/collapsed-document';
import {
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../lib/core/document/logic-document';
import { createGraph } from '../../../../lib/core/graph/create-graph';
import { foldedSourceDocument } from './folded-source-document';
import { type NormalizedLayoutGraph, normalizeLayoutGraph } from './normalized-graph';

export interface FoldedGroupWitness {
	readonly expanded: VisualLayout;
	readonly normalized: NormalizedLayoutGraph;
	readonly projectedRelations: readonly {
		readonly id: string;
		readonly from: string;
		readonly to: string;
		readonly sourceRelationIds: readonly string[];
	}[];
	readonly hiddenEndpointIds: readonly string[];
	readonly diagnostic: string;
}

/** The source is acyclic. Replacing A and B by G makes the visible graph cyclic. */
function foldedGroupDocument(): LogicDocument {
	return foldedSourceDocument({
		id: 'solver-folded-group',
		title: 'B → x → A, avec A et B dans G',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	});
}

/** Observe the actual current projection and engine; never invent a closed-group geometry. */
export async function runFoldedGroupWitness(): Promise<FoldedGroupWitness> {
	const source = foldedGroupDocument();
	const normalized = normalizeLayoutGraph(source, ['G']);
	if (!normalized.ok)
		throw new Error(normalized.diagnostics.map(({ message }) => message).join('; '));
	const expandedProjection = projectCollapsedDocument(source, []);
	const expandedFixture = await layoutDocument(expandedProjection.document);
	const expanded = new VisualLayout(
		expandedFixture.layout,
		expandedFixture.ranks.byEndpointId,
		source.layout.direction,
		undefined,
		expandedProjection.document,
	);
	const closedProjection = projectCollapsedDocument(source, ['G']);
	const closedGraph = createGraph(closedProjection.document);
	let diagnostic = 'La projection repliée est acceptée par le graphe actuel.';
	if (!closedGraph.ok)
		diagnostic = closedGraph.diagnostics.map(({ message }) => message).join('; ');
	return {
		expanded,
		normalized: normalized.value,
		projectedRelations: closedProjection.document.relations.map(({ id, from, to }) => ({
			id,
			from,
			to,
			sourceRelationIds: closedProjection.relations.get(id)?.sourceRelationIds ?? [],
		})),
		hiddenEndpointIds: [...closedProjection.hiddenEndpointIds].sort(),
		diagnostic,
	};
}
