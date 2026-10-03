import {
	contentStyleFields,
	groupStateFields,
	type LogicDocument,
	type LogicGroup,
	type LogicJunction,
	type LogicNature,
	type LogicNode,
	type LogicRelation,
	natureFamilyField,
	nodeDescriptionFields,
} from '../../core/document/logic-document';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
	SharedProperty,
	type SharedRootLanes,
} from './shared-document-command';

/** One step crossed backwards or forwards: from the document it left to the one it reaches. */
export interface HistoryCrossing {
	readonly from: LogicDocument;
	readonly to: LogicDocument;
}

interface Placement {
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
}

/** Where an element sits, leaving absent fields absent. */
function placementFields(element: Placement): Placement {
	const fields: { groupId?: string; laneId?: string; regionId?: string } = {};
	if (element.groupId !== undefined) fields.groupId = element.groupId;
	if (element.laneId !== undefined) fields.laneId = element.laneId;
	if (element.regionId !== undefined) fields.regionId = element.regionId;
	return fields;
}

interface RestoredFields<P, R extends keyof P, O extends keyof P> {
	readonly set: Partial<Pick<P, R | O>>;
	readonly unset: O[];
}

/** How one kind of element is read, created again and set back by commands. */
interface ElementHistory<T extends { readonly id: string }, R extends keyof T, O extends keyof T> {
	readonly elements: (document: LogicDocument) => readonly T[];
	/** Text fields travel with the creation, as a new element's do. */
	readonly create: (element: T) => SharedDocumentCommand;
	/** The non-text properties a step may change: required ones, and those it may add or remove. */
	readonly keys: { readonly required: readonly R[]; readonly optional: readonly O[] };
	readonly update: (id: string, fields: RestoredFields<T, R, O>) => SharedDocumentCommand;
}

/**
 * The properties the step changed that `current` no longer holds as before: set back, or unset
 * when the step added them. Properties the step left alone keep everyone's later edits.
 */
function restoredFields<T extends { readonly id: string }, R extends keyof T, O extends keyof T>(
	keys: ElementHistory<T, R, O>['keys'],
	crossing: { readonly from: T; readonly to: T },
	current: T,
): RestoredFields<T, R, O> | undefined {
	const { from, to } = crossing;
	const set: Partial<Pick<T, R | O>> = {};
	const unset: O[] = [];
	for (const key of keys.required)
		if (from[key] !== to[key] && current[key] !== to[key]) set[key] = to[key];
	for (const key of keys.optional) {
		const value = to[key];
		if (from[key] === value || current[key] === value) continue;
		if (value === undefined) unset.push(key);
		else set[key] = value;
	}
	if (Object.keys(set).length === 0 && unset.length === 0) return undefined;
	return { set, unset };
}

const NATURES: ElementHistory<
	LogicNature,
	SharedProperty.Color,
	SharedProperty.Icon | SharedProperty.Family
> = {
	elements: ({ natures }) => natures,
	create: (nature) => ({
		op: SharedCommandKind.Create,
		target: { kind: SharedElementKind.Nature, id: nature.id },
		properties: {
			label: nature.label,
			...contentStyleFields(undefined, nature.icon),
			color: nature.color,
			...natureFamilyField(nature.family),
		},
	}),
	keys: {
		required: [SharedProperty.Color],
		optional: [SharedProperty.Icon, SharedProperty.Family],
	},
	update: (id, fields) => ({
		op: SharedCommandKind.Update,
		target: { kind: SharedElementKind.Nature, id },
		...fields,
	}),
};

const GROUPS: ElementHistory<
	LogicGroup,
	never,
	| SharedProperty.Color
	| SharedProperty.GroupId
	| SharedProperty.LaneId
	| SharedProperty.RegionId
	| SharedProperty.State
> = {
	elements: ({ groups }) => groups,
	create: (group) => ({
		op: SharedCommandKind.Create,
		target: { kind: SharedElementKind.Group, id: group.id },
		properties: {
			label: group.label,
			...contentStyleFields(group.color, undefined),
			...placementFields(group),
			...groupStateFields(group.state),
		},
	}),
	keys: {
		required: [],
		optional: [
			SharedProperty.Color,
			SharedProperty.GroupId,
			SharedProperty.LaneId,
			SharedProperty.RegionId,
			SharedProperty.State,
		],
	},
	update: (id, fields) => ({
		op: SharedCommandKind.Update,
		target: { kind: SharedElementKind.Group, id },
		...fields,
	}),
};

const NODES: ElementHistory<
	LogicNode,
	SharedProperty.NatureId,
	| SharedProperty.GroupId
	| SharedProperty.LaneId
	| SharedProperty.RegionId
	| SharedProperty.Color
	| SharedProperty.Icon
> = {
	elements: ({ nodes }) => nodes,
	create: (node) => ({
		op: SharedCommandKind.Create,
		target: { kind: SharedElementKind.Node, id: node.id },
		properties: {
			natureId: node.natureId,
			markdown: node.markdown,
			...nodeDescriptionFields(node.description),
			...placementFields(node),
			...contentStyleFields(node.color, node.icon),
		},
	}),
	keys: {
		required: [SharedProperty.NatureId],
		optional: [
			SharedProperty.GroupId,
			SharedProperty.LaneId,
			SharedProperty.RegionId,
			SharedProperty.Color,
			SharedProperty.Icon,
		],
	},
	update: (id, fields) => ({
		op: SharedCommandKind.Update,
		target: { kind: SharedElementKind.Node, id },
		...fields,
	}),
};

const JUNCTIONS: ElementHistory<
	LogicJunction,
	SharedProperty.Operator,
	SharedProperty.GroupId | SharedProperty.LaneId | SharedProperty.RegionId
> = {
	elements: ({ junctions }) => junctions,
	create: (junction) => ({
		op: SharedCommandKind.Create,
		target: { kind: SharedElementKind.Junction, id: junction.id },
		properties: { operator: junction.operator, ...placementFields(junction) },
	}),
	keys: {
		required: [SharedProperty.Operator],
		optional: [SharedProperty.GroupId, SharedProperty.LaneId, SharedProperty.RegionId],
	},
	update: (id, fields) => ({
		op: SharedCommandKind.Update,
		target: { kind: SharedElementKind.Junction, id },
		...fields,
	}),
};

const RELATIONS: ElementHistory<LogicRelation, SharedProperty.From | SharedProperty.To, never> = {
	elements: ({ relations }) => relations,
	create: ({ id, from, to }) => ({
		op: SharedCommandKind.Create,
		target: { kind: SharedElementKind.Relation, id },
		properties: { from, to },
	}),
	keys: { required: [SharedProperty.From, SharedProperty.To], optional: [] },
	update: (id, fields) => ({
		op: SharedCommandKind.Update,
		target: { kind: SharedElementKind.Relation, id },
		...fields,
	}),
};

interface ElementChanges<T> {
	/** Elements the step deleted and nobody has brought back. */
	readonly restored: T[];
	readonly creations: SharedDocumentCommand[];
	readonly updates: SharedDocumentCommand[];
	/** Elements the step created that still exist. */
	readonly removals: string[];
}

function elementChanges<T extends { readonly id: string }, R extends keyof T, O extends keyof T>(
	history: ElementHistory<T, R, O>,
	crossing: HistoryCrossing,
	current: LogicDocument,
): ElementChanges<T> {
	const left = new Map(history.elements(crossing.from).map((element) => [element.id, element]));
	const present = new Map(history.elements(current).map((element) => [element.id, element]));
	const reached = history.elements(crossing.to);
	const changes: ElementChanges<T> = { restored: [], creations: [], updates: [], removals: [] };
	for (const element of reached) {
		const from = left.get(element.id);
		const now = present.get(element.id);
		if (from === undefined && now === undefined) {
			changes.restored.push(element);
			changes.creations.push(history.create(element));
		}
		if (from === undefined || now === undefined) continue;
		const fields = restoredFields(history.keys, { from, to: element }, now);
		if (fields !== undefined) changes.updates.push(history.update(element.id, fields));
	}
	const kept = new Set(reached.map(({ id }) => id));
	for (const id of left.keys()) if (!kept.has(id) && present.has(id)) changes.removals.push(id);
	return changes;
}

function rootLanes({ presentation }: LogicDocument): SharedRootLanes | undefined {
	if (presentation === undefined) return undefined;
	return { laneOrientation: presentation.laneOrientation, lanes: presentation.lanes };
}

/** Root lanes come back first, so that the elements restored next find theirs. */
function laneRestoration(
	crossing: HistoryCrossing,
	current: LogicDocument,
): readonly SharedDocumentCommand[] {
	const [left, reached, now] = [crossing.from, crossing.to, current].map((document) =>
		JSON.stringify(rootLanes(document)),
	);
	if (left === reached || now === reached) return [];
	const lanes = rootLanes(crossing.to);
	if (lanes === undefined) return [{ op: SharedCommandKind.UpdateLanes }];
	return [{ op: SharedCommandKind.UpdateLanes, lanes }];
}

function layoutRestoration(
	crossing: HistoryCrossing,
	current: LogicDocument,
): readonly SharedDocumentCommand[] {
	const [left, reached, now] = [crossing.from, crossing.to, current].map(
		({ layout }) => `${layout.direction} ${layout.bias}`,
	);
	if (left === reached || now === reached) return [];
	return [{ op: SharedCommandKind.UpdateLayout, layout: crossing.to.layout }];
}

/**
 * Removals follow the shared deletion order: relations, then nodes. A junction losing its
 * relations is collected with them; one that others have anchored since is removed explicitly,
 * its relations with it.
 */
function endpointRemovals(
	relations: ElementChanges<LogicRelation>,
	nodeIds: readonly string[],
	junctionIds: readonly string[],
	current: LogicDocument,
): readonly SharedDocumentCommand[] {
	const commands: SharedDocumentCommand[] = [];
	if (relations.removals.length > 0)
		commands.push({ op: SharedCommandKind.DeleteRelations, ids: relations.removals });
	for (const id of nodeIds)
		commands.push({ op: SharedCommandKind.Delete, target: { kind: SharedElementKind.Node, id } });
	const removed = new Set([...relations.removals, ...nodeIds]);
	const remaining = [...current.relations, ...relations.restored].filter(
		({ id, from, to }) => ![id, from, to].some((key) => removed.has(key)),
	);
	for (const id of junctionIds) {
		const anchored =
			remaining.some(({ to }) => to === id) && remaining.some(({ from }) => from === id);
		if (anchored)
			commands.push({
				op: SharedCommandKind.Delete,
				target: { kind: SharedElementKind.Junction, id },
			});
	}
	return commands;
}

/**
 * The batch that takes `current` across one step. Only what the step changed is restored,
 * property by property: what it created is removed, what it deleted is created again with its
 * identifier and its texts, and what it modified is set back where nobody has changed it since.
 * An element someone else has deleted since stays deleted. Creations come before removals so
 * that no junction is collected while it waits for its relations; an empty batch means there is
 * nothing left to restore.
 */
export function restoreHistoryStep(
	crossing: HistoryCrossing,
	current: LogicDocument,
): readonly SharedDocumentCommand[] {
	const natures = elementChanges(NATURES, crossing, current);
	const groups = elementChanges(GROUPS, crossing, current);
	const nodes = elementChanges(NODES, crossing, current);
	const junctions = elementChanges(JUNCTIONS, crossing, current);
	const relations = elementChanges(RELATIONS, crossing, current);
	const all = [natures, groups, nodes, junctions, relations];
	return [
		...laneRestoration(crossing, current),
		...all.flatMap(({ creations }) => creations),
		...all.flatMap(({ updates }) => updates),
		...endpointRemovals(relations, nodes.removals, junctions.removals, current),
		...groups.removals.map((id) => ({ op: SharedCommandKind.Ungroup, id }) as const),
		...natures.removals.map(
			(id) =>
				({ op: SharedCommandKind.Delete, target: { kind: SharedElementKind.Nature, id } }) as const,
		),
		...layoutRestoration(crossing, current),
	];
}
