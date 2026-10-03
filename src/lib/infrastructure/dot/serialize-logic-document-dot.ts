import { compareCanonicalStrings } from '../../core/canonical-string';
import {
	assertUniqueRelationIds,
	EndpointKind,
	LayoutDirection,
	type LogicDocument,
	type LogicEndpoint,
	type LogicGroup,
	type LogicJunction,
	type LogicNode,
} from '../../core/document/logic-document';

/** A quoted DOT value. Backslashes are doubled so labels cannot expand Graphviz escapes. */
function quoted(value: string): string {
	const escaped = value
		.replaceAll('\\', '\\\\')
		.replaceAll('"', '\\"')
		.replaceAll('\r\n', '\n')
		.replaceAll('\r', '\n')
		.replaceAll('\n', '\\n');
	return `"${escaped}"`;
}

function rankDirection(direction: LayoutDirection): string {
	switch (direction) {
		case LayoutDirection.TopToBottom:
			return 'BT';
		case LayoutDirection.BottomToTop:
			return 'TB';
		case LayoutDirection.LeftToRight:
			return 'RL';
		case LayoutDirection.RightToLeft:
			return 'LR';
		default:
			throw new Error('Unknown layout direction');
	}
}

function compareEndpoints(left: LogicEndpoint, right: LogicEndpoint): number {
	return (
		compareCanonicalStrings(left.layoutOrder, right.layoutOrder) ||
		compareCanonicalStrings(left.id, right.id)
	);
}

function nodeLine(node: LogicNode, natures: ReadonlyMap<string, string>, indent: string): string {
	const color = node.color ?? natures.get(node.natureId);
	const attributes = [`label=${quoted(node.markdown)}`];
	if (color !== undefined) attributes.push(`color=${quoted(color)}`);
	return `${indent}${quoted(node.id)} [${attributes.join(', ')}];`;
}

function junctionLine(junction: LogicJunction, indent: string): string {
	return `${indent}${quoted(junction.id)} [label=${quoted(junction.operator.toUpperCase())}, shape=circle];`;
}

function groupLines(
	group: LogicGroup,
	children: ReadonlyMap<string | undefined, readonly LogicEndpoint[]>,
	natures: ReadonlyMap<string, string>,
	indent: string,
): readonly string[] {
	const clusterId = `cluster_${group.id}`;
	const lines = [`${indent}subgraph ${quoted(clusterId)} {`, `${indent}  label="";`];
	if (group.color !== undefined) lines.push(`${indent}  color=${quoted(group.color)};`);
	lines.push(`${indent}  ${quoted(group.id)} [label=${quoted(group.label)}, shape=folder];`);
	lines.push(...endpointLines(children.get(group.id) ?? [], children, natures, `${indent}  `));
	lines.push(`${indent}}`);
	return lines;
}

function endpointLines(
	endpoints: readonly LogicEndpoint[],
	children: ReadonlyMap<string | undefined, readonly LogicEndpoint[]>,
	natures: ReadonlyMap<string, string>,
	indent: string,
): readonly string[] {
	const lines: string[] = [];
	for (const endpoint of [...endpoints].sort(compareEndpoints)) {
		switch (endpoint.kind) {
			case EndpointKind.Group:
				lines.push(...groupLines(endpoint, children, natures, indent));
				break;
			case EndpointKind.Node:
				lines.push(nodeLine(endpoint, natures, indent));
				break;
			case EndpointKind.Junction:
				lines.push(junctionLine(endpoint, indent));
				break;
			default:
				throw new Error('Unknown endpoint kind');
		}
	}
	return lines;
}

/** Export the logical graph; Graphviz computes its own geometry from these declarations. */
export function serializeLogicDocumentDot(document: LogicDocument): string {
	assertUniqueRelationIds(document.relations);
	const children = new Map<string | undefined, LogicEndpoint[]>();
	for (const endpoint of [...document.groups, ...document.nodes, ...document.junctions]) {
		const siblings = children.get(endpoint.groupId) ?? [];
		siblings.push(endpoint);
		children.set(endpoint.groupId, siblings);
	}
	const natures = new Map(document.natures.map(({ id, color }) => [id, color]));
	const lines = [
		`digraph ${quoted(document.id)} {`,
		`  graph [label=${quoted(document.title)}, rankdir=${rankDirection(document.layout.direction)}];`,
		'  node [shape=box];',
		...endpointLines(children.get(undefined) ?? [], children, natures, '  '),
	];
	for (const relation of [...document.relations].sort((left, right) =>
		compareCanonicalStrings(left.id, right.id),
	)) {
		lines.push(`  ${quoted(relation.from)} -> ${quoted(relation.to)} [id=${quoted(relation.id)}];`);
	}
	lines.push('}');
	return `${lines.join('\n')}\n`;
}
