import type { DocumentResult, LogicDocument, SequitDiagnostic } from './logic-document';
import { defined } from './logic-document';
import { SequitDiagnosticCode } from './logic-document';

enum GroupVisitState {
	Visiting = 'visiting',
	Visited = 'visited',
}

interface GroupVisitFrame {
	readonly groupId: string;
	parentVisited: boolean;
}

interface GroupVisitContext {
	readonly groupsById: ReadonlyMap<string, LogicDocument['groups'][number]>;
	readonly state: Map<string, GroupVisitState>;
	readonly path: string[];
	readonly pathIndex: Map<string, number>;
	readonly diagnostics: SequitDiagnostic[];
}

function visitGroupParent(
	frame: GroupVisitFrame,
	context: GroupVisitContext,
): GroupVisitFrame | undefined {
	context.state.set(frame.groupId, GroupVisitState.Visiting);
	context.pathIndex.set(frame.groupId, context.path.length);
	context.path.push(frame.groupId);
	frame.parentVisited = true;
	const parentId = context.groupsById.get(frame.groupId)?.groupId;
	if (parentId === undefined || !context.groupsById.has(parentId)) return undefined;
	if (context.state.get(parentId) === GroupVisitState.Visiting) {
		const cycle = [...context.path.slice(defined(context.pathIndex.get(parentId))), parentId];
		context.diagnostics.push({
			code: SequitDiagnosticCode.GroupCycle,
			message: `Group nesting cycle: ${cycle.join(' -> ')}`,
			path: ['groups', frame.groupId, 'group'],
		});
		return undefined;
	}
	if (context.state.get(parentId) === GroupVisitState.Visited) return undefined;
	return { groupId: parentId, parentVisited: false };
}

function advanceGroupVisit(
	frame: GroupVisitFrame,
	frames: GroupVisitFrame[],
	context: GroupVisitContext,
) {
	if (frame.parentVisited) return false;
	const parentFrame = visitGroupParent(frame, context);
	if (!parentFrame) return false;
	frames.push(parentFrame);
	return true;
}

function collectEndpointOwners(
	document: LogicDocument,
	diagnostics: SequitDiagnostic[],
): Map<string, readonly string[]> {
	const endpointOwners = new Map<string, readonly string[]>();
	for (const [collection, entities] of [
		['groups', document.groups],
		['nodes', document.nodes],
		['junctions', document.junctions],
	] as const) {
		for (const entity of entities) {
			const previousPath = endpointOwners.get(entity.id);
			if (!previousPath) {
				endpointOwners.set(entity.id, [collection, entity.id]);
				continue;
			}
			diagnostics.push({
				code: SequitDiagnosticCode.DuplicateEndpointId,
				message: `Endpoint id ${entity.id} is also used at ${previousPath.join('.')}`,
				path: [collection, entity.id],
			});
		}
	}
	return endpointOwners;
}

function collectGroupCycles(document: LogicDocument, diagnostics: SequitDiagnostic[]): void {
	const groupsById = new Map(document.groups.map((group) => [group.id, group]));
	const state = new Map<string, GroupVisitState>();
	const path: string[] = [];
	const pathIndex = new Map<string, number>();
	const context = { groupsById, state, path, pathIndex, diagnostics };
	for (const group of document.groups) {
		if (state.has(group.id)) continue;
		const frames: GroupVisitFrame[] = [{ groupId: group.id, parentVisited: false }];
		while (frames.length > 0) {
			const frame = defined(frames.at(-1));
			if (advanceGroupVisit(frame, frames, context)) continue;
			frames.pop();
			path.pop();
			pathIndex.delete(frame.groupId);
			state.set(frame.groupId, GroupVisitState.Visited);
		}
	}
}

export function validateLogicDocument(document: LogicDocument): DocumentResult<LogicDocument> {
	const diagnostics: SequitDiagnostic[] = [];
	const natureIds = new Set(document.natures.map(({ id }) => id));
	const groupIds = new Set(document.groups.map(({ id }) => id));
	const endpointOwners = collectEndpointOwners(document, diagnostics);

	for (const group of document.groups) {
		if (group.groupId !== undefined && !groupIds.has(group.groupId)) {
			diagnostics.push({
				code: SequitDiagnosticCode.UnknownGroup,
				message: `Unknown group: ${group.groupId}`,
				path: ['groups', group.id, 'group'],
			});
		}
	}

	collectGroupCycles(document, diagnostics);

	for (const node of document.nodes) {
		if (!natureIds.has(node.natureId)) {
			diagnostics.push({
				code: SequitDiagnosticCode.UnknownNature,
				message: `Unknown nature: ${node.natureId}`,
				path: ['nodes', node.id, 'nature'],
			});
		}
		if (node.groupId !== undefined && !groupIds.has(node.groupId)) {
			diagnostics.push({
				code: SequitDiagnosticCode.UnknownGroup,
				message: `Unknown group: ${node.groupId}`,
				path: ['nodes', node.id, 'group'],
			});
		}
	}

	for (const junction of document.junctions) {
		if (junction.groupId !== undefined && !groupIds.has(junction.groupId)) {
			diagnostics.push({
				code: SequitDiagnosticCode.UnknownGroup,
				message: `Unknown group: ${junction.groupId}`,
				path: ['junctions', junction.id, 'group'],
			});
		}
	}

	const endpointIds = new Set(endpointOwners.keys());
	for (const relation of document.relations) {
		if (!endpointIds.has(relation.from)) {
			diagnostics.push({
				code: SequitDiagnosticCode.UnknownEndpoint,
				message: `Unknown relation source: ${relation.from}`,
				path: ['relations', relation.id, 'from'],
			});
		}
		if (!endpointIds.has(relation.to)) {
			diagnostics.push({
				code: SequitDiagnosticCode.UnknownEndpoint,
				message: `Unknown relation target: ${relation.to}`,
				path: ['relations', relation.id, 'to'],
			});
		}
	}

	if (diagnostics.length === 0) return { ok: true, value: document };
	return { ok: false, diagnostics };
}
