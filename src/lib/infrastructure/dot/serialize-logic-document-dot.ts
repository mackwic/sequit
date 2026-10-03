import { compareCanonicalStrings } from '../../core/canonical-string';
import {
	assertUniqueRelationIds,
	EndpointKind,
	LayoutDirection,
	type LogicDocument,
	type LogicEndpoint,
	type LogicGroup,
	type LogicJunction,
	type LogicNature,
	type LogicNode,
	type LogicRelation,
} from '../../core/document/logic-document';
import { bodyMarkdown } from '../content/body-markdown';
import { mixedColor } from '../content/mixed-color';

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

function htmlText(value: string): string {
	// Graphviz rejects an empty FONT element; a non-breaking space renders a blank cell.
	if (value.length === 0) return '&#160;';
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll('\\', '\\\\')
		.replaceAll('\r\n', '\n')
		.replaceAll('\r', '\n')
		.replaceAll('\n', '<BR ALIGN="LEFT"/>');
}

function nodeLine(
	node: LogicNode,
	natures: ReadonlyMap<string, LogicNature>,
	indent: string,
): string {
	const nature = natures.get(node.natureId);
	if (nature === undefined) throw new Error(`Unknown node nature: ${node.natureId}`);
	const color = node.color ?? nature.color;
	const headerColor = htmlText(mixedColor(color, '#ffffff', 0.13));
	const borderColor = htmlText(mixedColor(color, '#d6d3d1', 0.35));
	const body = bodyMarkdown(node.markdown)
		.map(({ text }) => text)
		.join('')
		.trimEnd();
	const label = [
		`<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="12" COLOR="${borderColor}" BGCOLOR="#ffffff">`,
		`<TR><TD WIDTH="210" HEIGHT="30" ALIGN="LEFT" BGCOLOR="${headerColor}"><FONT POINT-SIZE="10">${htmlText(nature.label)}</FONT></TD></TR>`,
		`<TR><TD HEIGHT="54" ALIGN="LEFT" VALIGN="TOP"><FONT POINT-SIZE="14">${htmlText(body)}</FONT></TD></TR>`,
		'</TABLE>',
	].join('');
	return `${indent}${quoted(node.id)} [label=<${label}>];`;
}

function junctionLine(junction: LogicJunction, indent: string): string {
	return `${indent}${quoted(junction.id)} [label=${quoted(junction.operator.toUpperCase())}, shape=circle];`;
}

function groupLines(
	group: LogicGroup,
	children: ReadonlyMap<string | undefined, readonly LogicEndpoint[]>,
	natures: ReadonlyMap<string, LogicNature>,
	indent: string,
): readonly string[] {
	const clusterId = `cluster_${group.id}`;
	const lines = [
		`${indent}subgraph ${quoted(clusterId)} {`,
		`${indent}  label=${quoted(group.label)};`,
		`${indent}  labeljust=l; margin=20; color=${quoted(group.color ?? '#a7f3d0')};`,
		`${indent}  ${quoted(group.id)} [label="", shape=point, width=0, height=0, style=invis];`,
	];
	lines.push(...endpointLines(children.get(group.id) ?? [], children, natures, `${indent}  `));
	lines.push(`${indent}}`);
	return lines;
}

function endpointLines(
	endpoints: readonly LogicEndpoint[],
	children: ReadonlyMap<string | undefined, readonly LogicEndpoint[]>,
	natures: ReadonlyMap<string, LogicNature>,
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
function insideGroup(
	endpoint: string,
	group: string,
	parents: ReadonlyMap<string, string | undefined>,
): boolean {
	let current: string | undefined = endpoint;
	while (current !== undefined) {
		if (current === group) return true;
		current = parents.get(current);
	}
	return false;
}

function relationLine(
	relation: LogicRelation,
	groups: ReadonlySet<string>,
	parents: ReadonlyMap<string, string | undefined>,
): string {
	const attributes = [`id=${quoted(relation.id)}`];
	if (groups.has(relation.from) && !insideGroup(relation.to, relation.from, parents))
		attributes.push(`ltail=${quoted(`cluster_${relation.from}`)}`);
	if (groups.has(relation.to) && !insideGroup(relation.from, relation.to, parents))
		attributes.push(`lhead=${quoted(`cluster_${relation.to}`)}`);
	return `  ${quoted(relation.from)} -> ${quoted(relation.to)} [${attributes.join(', ')}];`;
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
	const natures = new Map(document.natures.map((nature) => [nature.id, nature]));
	const groups = new Set(document.groups.map(({ id }) => id));
	const parents = new Map(
		[...document.groups, ...document.nodes, ...document.junctions].map(({ id, groupId }) => [
			id,
			groupId,
		]),
	);
	const rankdir = rankDirection(document.layout.direction);
	let labelloc = 't';
	if (rankdir === 'BT') labelloc = 'b';
	const lines = [
		`digraph ${quoted(document.id)} {`,
		`  graph [label=${quoted(document.title)}, rankdir=${rankdir}, labelloc=${labelloc}, compound=true, splines=ortho, nodesep=0.5, ranksep=0.95, pad=0.3, bgcolor="#ffffff", fontname="Helvetica", fontsize=11, fontcolor="#1c1917"];`,
		'  node [shape=plain, fontname="Helvetica", fontcolor="#1c1917"];',
		'  edge [color="#292524", penwidth=1.3, arrowsize=0.8, arrowhead=vee];',
		...endpointLines(children.get(undefined) ?? [], children, natures, '  '),
	];
	for (const relation of [...document.relations].sort((left, right) =>
		compareCanonicalStrings(left.id, right.id),
	)) {
		lines.push(relationLine(relation, groups, parents));
	}
	lines.push('}');
	return `${lines.join('\n')}\n`;
}
