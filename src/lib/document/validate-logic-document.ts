import type { DocumentResult, LogicDocument, SequitDiagnostic } from './logic-document';

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
					code: 'duplicate-endpoint-id',
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
				code: 'unknown-group',
				message: `Unknown group: ${group.groupId}`,
				path: ['groups', group.id, 'group'],
			});
		}
	}

	const groupsById = new Map(document.groups.map((group) => [group.id, group]));
	const groupVisitState = new Map<string, 'visiting' | 'visited'>();
	const groupPath: string[] = [];
	function visitGroup(groupId: string): void {
		if (groupVisitState.get(groupId) === 'visited') return;
		if (groupVisitState.get(groupId) === 'visiting') {
			const cycleStart = groupPath.indexOf(groupId);
			const cycle = [...groupPath.slice(cycleStart), groupId];
			diagnostics.push({
				code: 'group-cycle',
				message: `Group nesting cycle: ${cycle.join(' -> ')}`,
				/* istanbul ignore next -- @preserve: a visiting group is always the last path entry. */
				path: ['groups', groupPath.at(-1) ?? groupId, 'group'],
			});
			return;
		}
		groupVisitState.set(groupId, 'visiting');
		groupPath.push(groupId);
		const parentGroupId = groupsById.get(groupId)?.groupId;
		if (parentGroupId !== undefined && groupsById.has(parentGroupId)) visitGroup(parentGroupId);
		groupPath.pop();
		groupVisitState.set(groupId, 'visited');
	}
	for (const group of document.groups) visitGroup(group.id);

	for (const node of document.nodes) {
		if (!natureIds.has(node.natureId)) {
			diagnostics.push({
				code: 'unknown-nature',
				message: `Unknown nature: ${node.natureId}`,
				path: ['nodes', node.id, 'nature'],
			});
		}
		if (node.groupId !== undefined && !groupIds.has(node.groupId)) {
			diagnostics.push({
				code: 'unknown-group',
				message: `Unknown group: ${node.groupId}`,
				path: ['nodes', node.id, 'group'],
			});
		}
	}

	for (const junction of document.junctions) {
		if (junction.groupId !== undefined && !groupIds.has(junction.groupId)) {
			diagnostics.push({
				code: 'unknown-group',
				message: `Unknown group: ${junction.groupId}`,
				path: ['junctions', junction.id, 'group'],
			});
		}
	}

	return diagnostics.length === 0 ? { ok: true, value: document } : { ok: false, diagnostics };
}
