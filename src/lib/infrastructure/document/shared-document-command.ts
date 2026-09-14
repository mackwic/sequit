import type {
	LayoutConfiguration,
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
	UpdateLayout = 'updateLayout',
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
		| SharedProperty.Color
		| SharedProperty.Icon
	>;
	readonly [SharedElementKind.Group]: Pick<
		LogicGroup,
		SharedProperty.Label | SharedProperty.GroupId | SharedProperty.State
	>;
	readonly [SharedElementKind.Nature]: Pick<
		LogicNature,
		SharedProperty.Label | SharedProperty.Color | SharedProperty.Icon
	>;
	readonly [SharedElementKind.Junction]: Pick<
		LogicJunction,
		SharedProperty.Operator | SharedProperty.GroupId
	>;
	readonly [SharedElementKind.Relation]: Pick<
		LogicRelation,
		SharedProperty.From | SharedProperty.To
	>;
}

interface SharedUpdateProperties {
	readonly [SharedElementKind.Node]: Pick<
		LogicNode,
		SharedProperty.NatureId | SharedProperty.GroupId | SharedProperty.Color | SharedProperty.Icon
	>;
	readonly [SharedElementKind.Group]: Pick<
		LogicGroup,
		SharedProperty.GroupId | SharedProperty.State
	>;
	readonly [SharedElementKind.Nature]: Pick<
		LogicNature,
		SharedProperty.Color | SharedProperty.Icon
	>;
	readonly [SharedElementKind.Junction]: Pick<
		LogicJunction,
		SharedProperty.Operator | SharedProperty.GroupId
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

interface UpdateSharedLayout {
	readonly op: SharedCommandKind.UpdateLayout;
	readonly layout: LayoutConfiguration;
}

export type SharedDocumentCommand =
	| CreateElement
	| UpdateElement
	| DeleteElement
	| DeleteNature
	| DeleteRelations
	| GroupElements
	| UngroupElements
	| UpdateSharedLayout;
