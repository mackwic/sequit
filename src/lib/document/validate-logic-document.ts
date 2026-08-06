import {
	type DocumentResult,
	type LogicDocument,
	type SequitDiagnostic,
	SequitDiagnosticCode,
} from './logic-document';

enum GroupVisitState {
	Visiting = 'visiting',
	Visited = 'visited',
}

export function validateLogicDocument(document: LogicDocument): DocumentResult<LogicDocument> {
	const diagnostics: SequitDiagnostic[] = [];
	const natureIds = new Set(document.natures.map(({ id }) => id));
	const groupIds = new Set(document.groups.map(({ id }) => id));
	const endpointOwners = new Map<string, readonly string[]>();

	for (const [collection, entities] of [
		['groups', document.groups],
		['nodes', document.nodes],
		['junctions', document.junctions],
	] as const) {
		for (const entity of entities) {
			const previousPath = endpointOwners.get(entity.id);
			if (previousPath) {
				diagnostics.push({
					code: SequitDiagnosticCode.DuplicateEndpointId,
					message: `Endpoint id ${entity.id} is also used at ${previousPath.join('.')}`,
					path: [collection, entity.id],
				});
			} else {
				endpointOwners.set(entity.id, [collection, entity.id]);
			}
		}
	}

	for (const group of document.groups) {
		if (group.groupId !== undefined && !groupIds.has(group.groupId)) {
			diagnostics.push({
				code: SequitDiagnosticCode.UnknownGroup,
				message: `Unknown group: ${group.groupId}`,
				path: ['groups', group.id, 'group'],
			});
		}
	}

	const groupsById = new Map(document.groups.map((group) => [group.id, group]));
	const groupVisitState = new Map<string, GroupVisitState>();
	const groupPath: string[] = [];
	function visitGroup(groupId: string): void {
		if (groupVisitState.get(groupId) === GroupVisitState.Visited) return;
		if (groupVisitState.get(groupId) === GroupVisitState.Visiting) {
			const cycleStart = groupPath.indexOf(groupId);
			const cycle = [...groupPath.slice(cycleStart), groupId];
			diagnostics.push({
				code: SequitDiagnosticCode.GroupCycle,
				message: `Group nesting cycle: ${cycle.join(' -> ')}`,
				/* istanbul ignore next -- @preserve: a visiting group is always the last path entry. */
				path: ['groups', groupPath.at(-1) ?? groupId, 'group'],
			});
			return;
		}
		groupVisitState.set(groupId, GroupVisitState.Visiting);
		groupPath.push(groupId);
		const parentGroupId = groupsById.get(groupId)?.groupId;
		if (parentGroupId !== undefined && groupsById.has(parentGroupId)) visitGroup(parentGroupId);
		groupPath.pop();
		groupVisitState.set(groupId, GroupVisitState.Visited);
	}
	for (const group of document.groups) visitGroup(group.id);

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

	if (diagnostics.length === 0) return { ok: true, value: document };
	return { ok: false, diagnostics };
}
