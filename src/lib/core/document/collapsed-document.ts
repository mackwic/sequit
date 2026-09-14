import { compareCanonicalStrings } from '../canonical-string';
import type { LogicDocument, LogicRelation } from './logic-document';
import { defined } from './logic-document';

export interface VisibleRelationProjection {
	readonly sourceRelationIds: readonly string[];
	readonly canChangeFrom: boolean;
	readonly canChangeTo: boolean;
}

export interface CollapsedDocumentProjection {
	readonly document: LogicDocument;
	readonly relations: ReadonlyMap<string, VisibleRelationProjection>;
	readonly hiddenEndpointIds: ReadonlySet<string>;
}

function visibleEndpoints(
	model: LogicDocument,
	collapsed: ReadonlySet<string>,
): Map<string, string> {
	const endpoints = [...model.groups, ...model.nodes, ...model.junctions];
	const parents = new Map(endpoints.map((item) => [item.id, item.groupId]));
	const visible = new Map<string, string>();
	for (const endpoint of endpoints) {
		const path: string[] = [];
		let current: string | undefined = endpoint.id;
		while (current !== undefined && !visible.has(current)) {
			path.push(current);
			current = parents.get(current);
		}
		let ancestor = current;
		if (current !== undefined) ancestor = defined(visible.get(current));
		for (const id of path.reverse()) {
			if (ancestor === undefined || !collapsed.has(ancestor)) ancestor = id;
			visible.set(id, ancestor);
		}
	}
	return visible;
}

interface ProjectedRelation {
	readonly source: LogicRelation;
	readonly visible: LogicRelation;
}

function relationProjection(relations: readonly ProjectedRelation[]): VisibleRelationProjection {
	return {
		sourceRelationIds: relations.map(({ source }) => source.id),
		canChangeFrom:
			relations.length === 1 &&
			relations.every(({ source, visible }) => source.from === visible.from),
		canChangeTo:
			relations.length === 1 && relations.every(({ source, visible }) => source.to === visible.to),
	};
}

/** Visible relations carry provenance; their representative ID is never a deletion command. */
export function projectCollapsedDocument(
	model: LogicDocument,
	collapsed: readonly string[],
): CollapsedDocumentProjection {
	const visible = visibleEndpoints(model, new Set(collapsed));
	const hiddenEndpointIds = new Set(
		[...visible].filter(([id, shown]) => id !== shown).map(([id]) => id),
	);
	const pairs = new Map<string, ProjectedRelation[]>();
	const ordered = [...model.relations].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	for (const source of ordered) {
		const from = defined(visible.get(source.from));
		const to = defined(visible.get(source.to));
		if (from === to) continue;
		const key = JSON.stringify([from, to]);
		const pair = pairs.get(key) ?? [];
		pair.push({ source, visible: { ...source, from, to } });
		pairs.set(key, pair);
	}
	const relations = new Map<string, VisibleRelationProjection>();
	const projected: LogicRelation[] = [];
	for (const pair of pairs.values()) {
		const hidden = pair.some(({ source }) =>
			[source.from, source.to].some((id) => hiddenEndpointIds.has(id)),
		);
		let bundles = pair.map((item) => [item]);
		if (hidden) bundles = [pair];
		for (const bundle of bundles) {
			const relation = defined(bundle[0]).visible;
			projected.push(relation);
			relations.set(relation.id, relationProjection(bundle));
		}
	}
	projected.sort((a, b) => compareCanonicalStrings(a.id, b.id));
	return {
		document: {
			...model,
			nodes: model.nodes.filter(({ id }) => !hiddenEndpointIds.has(id)),
			groups: model.groups.filter(({ id }) => !hiddenEndpointIds.has(id)),
			junctions: model.junctions.filter(({ id }) => !hiddenEndpointIds.has(id)),
			relations: projected,
		},
		relations,
		hiddenEndpointIds,
	};
}

/** Collapse affects only the projection; the complete source document stays editable when expanded. */
export function collapsedDocument(
	model: LogicDocument,
	collapsed: readonly string[],
): LogicDocument {
	return projectCollapsedDocument(model, collapsed).document;
}
