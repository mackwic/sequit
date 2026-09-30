import type {
	LaneOrientation,
	LayoutConfiguration,
	LayoutLane,
	LogicGroup,
	LogicJunction,
	LogicNature,
	LogicNode,
	LogicRelation,
} from '../../core/document/logic-document';

export enum SharedElementKind {
	Document = 'document',
	Node = 'node',
	Group = 'group',
	Nature = 'nature',
	Junction = 'junction',
	Relation = 'relation',
}

export enum SharedCommandKind {
	Create = 'create',
	Update = 'update',
	Delete = 'delete',
	DeleteRelations = 'deleteRelations',
	Group = 'group',
	Ungroup = 'ungroup',
	Move = 'move',
	UpdateLayout = 'updateLayout',
	UpdateLanes = 'updateLanes',
}

export interface SharedTarget<K extends SharedElementKind = SharedElementKind> {
	readonly kind: K;
	readonly id: string;
}

export enum SharedProperty {
	Markdown = 'markdown',
	Description = 'description',
	NatureId = 'natureId',
	GroupId = 'groupId',
	LaneId = 'laneId',
	RegionId = 'regionId',
	Color = 'color',
	Icon = 'icon',
	Label = 'label',
	State = 'state',
	Operator = 'operator',
	From = 'from',
	To = 'to',
}

/** Text fields may be initialized here; subsequent text edits use their stable Y.Text. */
interface SharedCreateProperties {
	readonly [SharedElementKind.Node]: Pick<
		LogicNode,
		| SharedProperty.NatureId
		| SharedProperty.Markdown
		| SharedProperty.Description
		| SharedProperty.GroupId
		| SharedProperty.LaneId
		| SharedProperty.RegionId
		| SharedProperty.Color
		| SharedProperty.Icon
	>;
	readonly [SharedElementKind.Group]: Pick<
		LogicGroup,
		| SharedProperty.Label
		| SharedProperty.Color
		| SharedProperty.GroupId
		| SharedProperty.LaneId
		| SharedProperty.RegionId
		| SharedProperty.State
	>;
	readonly [SharedElementKind.Nature]: Pick<
		LogicNature,
		SharedProperty.Label | SharedProperty.Color | SharedProperty.Icon
	>;
	readonly [SharedElementKind.Junction]: Pick<
		LogicJunction,
		| SharedProperty.Operator
		| SharedProperty.GroupId
		| SharedProperty.LaneId
		| SharedProperty.RegionId
	>;
	readonly [SharedElementKind.Relation]: Pick<
		LogicRelation,
		SharedProperty.From | SharedProperty.To
	>;
}

interface SharedUpdateProperties {
	readonly [SharedElementKind.Node]: Pick<
		LogicNode,
		| SharedProperty.NatureId
		| SharedProperty.GroupId
		| SharedProperty.LaneId
		| SharedProperty.RegionId
		| SharedProperty.Color
		| SharedProperty.Icon
	>;
	readonly [SharedElementKind.Group]: Pick<
		LogicGroup,
		| SharedProperty.Color
		| SharedProperty.GroupId
		| SharedProperty.LaneId
		| SharedProperty.RegionId
		| SharedProperty.State
	>;
	readonly [SharedElementKind.Nature]: Pick<
		LogicNature,
		SharedProperty.Color | SharedProperty.Icon
	>;
	readonly [SharedElementKind.Junction]: Pick<
		LogicJunction,
		| SharedProperty.Operator
		| SharedProperty.GroupId
		| SharedProperty.LaneId
		| SharedProperty.RegionId
	>;
	readonly [SharedElementKind.Relation]: Pick<
		LogicRelation,
		SharedProperty.From | SharedProperty.To
	>;
}

type SharedOptionalUpdateField<K extends keyof SharedUpdateProperties> = {
	[P in keyof SharedUpdateProperties[K]]-?: undefined extends SharedUpdateProperties[K][P]
		? P
		: never;
}[keyof SharedUpdateProperties[K]];

export type CreateElement = {
	[K in keyof SharedCreateProperties]: {
		readonly op: SharedCommandKind.Create;
		readonly target: SharedTarget<K>;
		readonly properties: SharedCreateProperties[K];
	};
}[keyof SharedCreateProperties];

export type UpdateElement = {
	[K in keyof SharedUpdateProperties]: {
		readonly op: SharedCommandKind.Update;
		readonly target: SharedTarget<K>;
		readonly set: Partial<SharedUpdateProperties[K]>;
		readonly unset: readonly SharedOptionalUpdateField<K>[];
	};
}[keyof SharedUpdateProperties];

interface DeleteElement {
	readonly op: SharedCommandKind.Delete;
	readonly target: SharedTarget<
		SharedElementKind.Node | SharedElementKind.Junction | SharedElementKind.Relation
	>;
	readonly replacementId?: never;
}

interface DeleteNature {
	readonly op: SharedCommandKind.Delete;
	readonly target: SharedTarget<SharedElementKind.Nature>;
	readonly replacementId?: string;
}

interface DeleteRelations {
	readonly op: SharedCommandKind.DeleteRelations;
	readonly ids: readonly string[];
}

interface GroupElements {
	readonly op: SharedCommandKind.Group;
	readonly id: string;
	readonly label: string;
	readonly members: readonly string[];
}

interface UngroupElements {
	readonly op: SharedCommandKind.Ungroup;
	readonly id: string;
}

/**
 * Nodes and groups enter `groupId`, or return to the root when it is omitted; a listed junction
 * stays with its targets.
 */
interface MoveElements {
	readonly op: SharedCommandKind.Move;
	readonly ids: readonly string[];
	readonly groupId?: string;
}

interface UpdateSharedLayout {
	readonly op: SharedCommandKind.UpdateLayout;
	readonly layout: LayoutConfiguration;
}

export interface SharedRootLanes {
	readonly laneOrientation: LaneOrientation;
	readonly lanes: readonly LayoutLane[];
}

/**
 * Replaces the root lanes in one atomic step. Top-level elements keep their lane when it survives;
 * the content of a removed lane follows `transfers`, or lands in the first lane. Omitting `lanes`
 * returns the document to its single implicit lane.
 */
interface UpdateSharedLanes {
	readonly op: SharedCommandKind.UpdateLanes;
	readonly lanes?: SharedRootLanes;
	readonly transfers?: Readonly<Record<string, string>>;
}

export type SharedDocumentCommand =
	| CreateElement
	| UpdateElement
	| DeleteElement
	| DeleteNature
	| DeleteRelations
	| GroupElements
	| UngroupElements
	| MoveElements
	| UpdateSharedLayout
	| UpdateSharedLanes;
