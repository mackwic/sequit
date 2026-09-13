import type { LayoutConfiguration } from '../../core/document/logic-document';

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
	Group = 'group',
	Ungroup = 'ungroup',
	UpdateLayout = 'updateLayout',
}

export interface SharedTarget {
	readonly kind: SharedElementKind;
	readonly id: string;
}

interface CreateElement {
	readonly op: SharedCommandKind.Create;
	readonly target: SharedTarget;
	readonly properties: Readonly<Record<string, string>>;
}

interface UpdateElement {
	readonly op: SharedCommandKind.Update;
	readonly target: SharedTarget;
	readonly set: Readonly<Record<string, string>>;
	readonly unset: readonly string[];
}

interface DeleteElement {
	readonly op: SharedCommandKind.Delete;
	readonly target: SharedTarget;
	readonly replacementId?: string;
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
	| GroupElements
	| UngroupElements
	| UpdateSharedLayout;
