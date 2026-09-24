import { compareCanonicalStrings } from '../canonical-string';
import {
	EndpointKind,
	LayoutPolicy,
	type LayoutRegionDefinition,
	type LogicDocument,
} from './logic-document';
import { type OrderKey, parseOrderKey } from './order-key';
import {
	normalizedRegionLaneFields,
	regionLeafLaneAssignmentIssues,
	regionLeafLaneDefinitionIssues,
} from './region-leaf-lane-presentation';
import {
	type RegionPresentationIssue,
	RegionPresentationIssueCode,
} from './region-presentation-issues';

export type { LayoutRegionDefinition } from './logic-document';
export { RegionPresentationIssueCode } from './region-presentation-issues';

/** A virtual root exists even when the document has no explicit region preferences. */
export const ROOT_LAYOUT_REGION_ID = '@root';

interface NormalizedLayoutRegion {
	readonly id: string;
	readonly parentId?: string;
	readonly layoutOrder?: OrderKey;
	readonly policy: LayoutPolicy.Layered;
	readonly lanePresentation?: NonNullable<LayoutRegionDefinition['lanePresentation']>;
	readonly grid?: NonNullable<LayoutRegionDefinition['grid']>;
}

interface NormalizedRegionPresentation {
	/** Parent-before-child, then document order within each sibling set. */
	readonly regions: readonly NormalizedLayoutRegion[];
	readonly regionByEndpointId: ReadonlyMap<string, string>;
	/** Local lane ids are inherited through groups; undefined means no explicit lane. */
	readonly laneByEndpointId: ReadonlyMap<string, string | undefined>;
}

export enum RegionPresentationStatus {
	Ready = 'ready',
	Invalid = 'invalid',
}

interface ReadyRegionPresentation {
	readonly status: RegionPresentationStatus.Ready;
	readonly value: NormalizedRegionPresentation;
}

interface InvalidRegionPresentation {
	readonly status: RegionPresentationStatus.Invalid;
	readonly issues: readonly RegionPresentationIssue[];
}

export type RegionPresentationResult = ReadyRegionPresentation | InvalidRegionPresentation;

function validRegionDefinition(definition: LayoutRegionDefinition): boolean {
	const validId = definition.id.trim() !== '' && definition.id !== ROOT_LAYOUT_REGION_ID;
	const validOrder = parseOrderKey(definition.layoutOrder) !== undefined;
	const policy: unknown = definition.policy;
	return validId && validOrder && policy === LayoutPolicy.Layered;
}

function regionIssues(definitions: readonly LayoutRegionDefinition[]): {
	readonly byId: ReadonlyMap<string, LayoutRegionDefinition>;
	readonly issues: readonly RegionPresentationIssue[];
} {
	const issues: RegionPresentationIssue[] = [];
	const byId = new Map<string, LayoutRegionDefinition>();
	const sorted = [...definitions].sort((left, right) => compareCanonicalStrings(left.id, right.id));
	for (const definition of sorted) {
		if (!validRegionDefinition(definition))
			issues.push({
				code: RegionPresentationIssueCode.InvalidRegion,
				id: definition.id,
			});
		if (byId.has(definition.id)) {
			issues.push({
				code: RegionPresentationIssueCode.DuplicateRegion,
				id: definition.id,
			});
			continue;
		}
		byId.set(definition.id, definition);
	}
	issues.push(...regionLeafLaneDefinitionIssues(sorted));
	for (const definition of sorted) {
		const parentId = definition.parentId ?? ROOT_LAYOUT_REGION_ID;
		if (parentId !== ROOT_LAYOUT_REGION_ID && !byId.has(parentId))
			issues.push({
				code: RegionPresentationIssueCode.UnknownParent,
				id: definition.id,
			});
	}
	return { byId, issues };
}

function canVisitRegion(
	id: string | undefined,
	byId: ReadonlyMap<string, LayoutRegionDefinition>,
	visited: ReadonlySet<string>,
): id is string {
	if (id === undefined) return false;
	return byId.has(id) && !visited.has(id);
}

function addCyclicMembers(path: readonly string[], firstIndex: number, cyclic: Set<string>): void {
	for (const member of path.slice(firstIndex)) cyclic.add(member);
}

function cyclicRegionIds(byId: ReadonlyMap<string, LayoutRegionDefinition>): ReadonlySet<string> {
	const cyclic = new Set<string>();
	const visited = new Set<string>();
	for (const startId of [...byId.keys()].sort(compareCanonicalStrings)) {
		if (visited.has(startId)) continue;
		const path: string[] = [];
		const indexById = new Map<string, number>();
		let id: string | undefined = startId;
		while (canVisitRegion(id, byId, visited)) {
			const cycleStart = indexById.get(id);
			if (cycleStart !== undefined) {
				addCyclicMembers(path, cycleStart, cyclic);
				break;
			}
			indexById.set(id, path.length);
			path.push(id);
			id = byId.get(id)?.parentId;
		}
		for (const member of path) visited.add(member);
	}
	return cyclic;
}

function normalizedRegions(
	byId: ReadonlyMap<string, LayoutRegionDefinition>,
): readonly NormalizedLayoutRegion[] {
	const children = new Map<string, LayoutRegionDefinition[]>();
	for (const definition of byId.values()) {
		const parentId = definition.parentId ?? ROOT_LAYOUT_REGION_ID;
		const siblings = children.get(parentId) ?? [];
		siblings.push(definition);
		children.set(parentId, siblings);
	}
	for (const siblings of children.values())
		siblings.sort(
			(left, right) =>
				compareCanonicalStrings(left.layoutOrder, right.layoutOrder) ||
				compareCanonicalStrings(left.id, right.id),
		);
	const result: NormalizedLayoutRegion[] = [
		{ id: ROOT_LAYOUT_REGION_ID, policy: LayoutPolicy.Layered },
	];
	const stack = [...(children.get(ROOT_LAYOUT_REGION_ID) ?? [])].reverse();
	while (stack.length > 0) {
		const next = stack.pop();
		if (next === undefined) continue;
		const gridFields: { grid?: NonNullable<LayoutRegionDefinition['grid']> } = {};
		if (next.grid !== undefined) gridFields.grid = next.grid;
		result.push({
			id: next.id,
			parentId: next.parentId ?? ROOT_LAYOUT_REGION_ID,
			layoutOrder: next.layoutOrder,
			policy: next.policy,
			...normalizedRegionLaneFields(next),
			...gridFields,
		});
		stack.push(...[...(children.get(next.id) ?? [])].reverse());
	}
	return result;
}

type Endpoint =
	| LogicDocument['groups'][number]
	| LogicDocument['nodes'][number]
	| LogicDocument['junctions'][number];

function validateAssignments(
	byEndpointId: ReadonlyMap<string, Endpoint>,
	byRegionId: ReadonlyMap<string, LayoutRegionDefinition>,
	assignments: ReadonlyMap<string, string>,
	issues: RegionPresentationIssue[],
): void {
	for (const [id, regionId] of [...assignments].sort(([a], [b]) => compareCanonicalStrings(a, b))) {
		if (!byEndpointId.has(id))
			issues.push({ code: RegionPresentationIssueCode.UnknownEndpoint, id });
		if (regionId !== ROOT_LAYOUT_REGION_ID && !byRegionId.has(regionId))
			issues.push({
				code: RegionPresentationIssueCode.UnknownAssignedRegion,
				id,
			});
	}
}

function endpointPath(
	endpoint: Endpoint,
	byEndpointId: ReadonlyMap<string, Endpoint>,
	ownership: ReadonlyMap<string, string>,
	issues: RegionPresentationIssue[],
): readonly Endpoint[] {
	const path: Endpoint[] = [];
	const seen = new Set<string>();
	let current: Endpoint = endpoint;
	while (!ownership.has(current.id)) {
		if (seen.has(current.id)) {
			issues.push({
				code: RegionPresentationIssueCode.InvalidGroupParent,
				id: endpoint.id,
			});
			break;
		}
		seen.add(current.id);
		path.push(current);
		if (current.groupId === undefined) break;
		const parent = byEndpointId.get(current.groupId);
		if (parent?.kind !== EndpointKind.Group) {
			issues.push({
				code: RegionPresentationIssueCode.InvalidGroupParent,
				id: current.id,
			});
			break;
		}
		current = parent;
	}
	return path;
}

interface EndpointOwnershipContext {
	readonly assignments: ReadonlyMap<string, string>;
	readonly ownership: Map<string, string>;
	readonly laneOwnership: Map<string, string | undefined>;
	readonly issues: RegionPresentationIssue[];
}

function ownEndpointPath(path: readonly Endpoint[], context: EndpointOwnershipContext): void {
	const last = path.at(-1);
	let regionId = ROOT_LAYOUT_REGION_ID;
	let laneId: string | undefined;
	if (last?.groupId !== undefined)
		regionId = context.ownership.get(last.groupId) ?? ROOT_LAYOUT_REGION_ID;
	if (last?.groupId !== undefined) laneId = context.laneOwnership.get(last.groupId);
	for (const member of [...path].reverse()) {
		const assigned = context.assignments.get(member.id);
		if (member.groupId !== undefined && assigned !== undefined)
			context.issues.push({
				code: RegionPresentationIssueCode.InheritedAssignment,
				id: member.id,
			});
		if (member.groupId === undefined) regionId = assigned ?? ROOT_LAYOUT_REGION_ID;
		if (member.groupId === undefined) laneId = member.laneId;
		context.ownership.set(member.id, regionId);
		context.laneOwnership.set(member.id, laneId);
	}
}

function endpointIssues(
	document: LogicDocument,
	byRegionId: ReadonlyMap<string, LayoutRegionDefinition>,
	assignments: ReadonlyMap<string, string>,
): {
	readonly ownership: ReadonlyMap<string, string>;
	readonly laneOwnership: ReadonlyMap<string, string | undefined>;
	readonly issues: readonly RegionPresentationIssue[];
} {
	const issues: RegionPresentationIssue[] = [];
	const endpoints = [...document.groups, ...document.nodes, ...document.junctions];
	const byEndpointId = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
	const ownership = new Map<string, string>();
	const laneOwnership = new Map<string, string | undefined>();
	const context = { assignments, ownership, laneOwnership, issues };
	validateAssignments(byEndpointId, byRegionId, assignments, issues);
	for (const endpoint of [...endpoints].sort((a, b) => compareCanonicalStrings(a.id, b.id))) {
		const path = endpointPath(endpoint, byEndpointId, ownership, issues);
		ownEndpointPath(path, context);
	}
	issues.push(...regionLeafLaneAssignmentIssues(document, endpoints, byRegionId, ownership));
	return { ownership, laneOwnership, issues };
}

/** Normalize a presentation boundary without mutating the source document. */
export function normalizeRegionPresentation(
	document: LogicDocument,
	definitions: readonly LayoutRegionDefinition[] = [],
	assignments: ReadonlyMap<string, string> = new Map(),
): RegionPresentationResult {
	const regionCheck = regionIssues(definitions);
	const cyclic = cyclicRegionIds(regionCheck.byId);
	const issues: RegionPresentationIssue[] = [...regionCheck.issues];
	for (const id of [...cyclic].sort(compareCanonicalStrings))
		issues.push({ code: RegionPresentationIssueCode.RegionCycle, id });
	const endpointCheck = endpointIssues(document, regionCheck.byId, assignments);
	issues.push(...endpointCheck.issues);
	if (issues.length > 0) return { status: RegionPresentationStatus.Invalid, issues };
	return {
		status: RegionPresentationStatus.Ready,
		value: {
			regions: normalizedRegions(regionCheck.byId),
			regionByEndpointId: endpointCheck.ownership,
			laneByEndpointId: endpointCheck.laneOwnership,
		},
	};
}
