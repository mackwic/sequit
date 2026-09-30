import {
	contentStyleFields,
	type LogicDocument,
	type LogicNature,
} from '../../core/document/logic-document';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
	SharedProperty,
} from './shared-document-command';

/** What an author edits in the nature dialog; `''` for icon means no icon. */
export interface NatureFields {
	readonly label: string;
	readonly color: string;
	readonly icon: string;
}

/** A nature without an icon and one that hides it explicitly both edit as no icon. */
export function natureFields(nature: LogicNature): NatureFields {
	let icon = nature.icon ?? '';
	if (icon === 'none') icon = '';
	return { label: nature.label, color: nature.color, icon };
}

export function natureCreation(id: string, fields: NatureFields): SharedDocumentCommand {
	return {
		op: SharedCommandKind.Create,
		target: { kind: SharedElementKind.Nature, id },
		properties: {
			label: fields.label.trim(),
			color: fields.color,
			...contentStyleFields(undefined, fields.icon || undefined),
		},
	};
}

/** The label is a text: callers splice it through `updateText`; colour and icon travel here. */
export function natureStyleUpdate(
	natureId: string,
	before: NatureFields,
	after: NatureFields,
): SharedDocumentCommand | undefined {
	if (before.color === after.color && before.icon === after.icon) return undefined;
	const target = { kind: SharedElementKind.Nature, id: natureId } as const;
	const set: { color?: string; icon?: string } = {};
	if (before.color !== after.color) set.color = after.color;
	if (before.icon !== after.icon && after.icon !== '') set.icon = after.icon;
	const unset: SharedProperty.Icon[] = [];
	if (before.icon !== after.icon && after.icon === '') unset.push(SharedProperty.Icon);
	return { op: SharedCommandKind.Update, target, set, unset };
}

/** The executor refuses to remove a used nature without a replacement, or with itself. */
export function natureDeletion(
	natureId: string,
	replacementId: string | undefined,
): SharedDocumentCommand {
	const target = { kind: SharedElementKind.Nature, id: natureId } as const;
	if (replacementId === undefined) return { op: SharedCommandKind.Delete, target };
	return { op: SharedCommandKind.Delete, target, replacementId };
}

export enum NatureEditingMode {
	/** Fills a nature the document does not hold yet. */
	Create = 'create',
	Edit = 'edit',
}

/** The nature dialog's form. */
export interface NatureEditing {
	readonly id: string;
	readonly mode: NatureEditingMode;
	readonly base: NatureFields;
	readonly draft: NatureFields;
}

const NEW_NATURE: NatureFields = { label: '', color: '#6f70e8', icon: '' };

export function newNatureEditing(id: string): NatureEditing {
	return { id, mode: NatureEditingMode.Create, base: NEW_NATURE, draft: NEW_NATURE };
}

export function natureEditing(nature: LogicNature): NatureEditing {
	const fields = natureFields(nature);
	return { id: nature.id, mode: NatureEditingMode.Edit, base: fields, draft: fields };
}

/** Boxes per nature, including zero for unused natures. */
export function natureUsage(document: LogicDocument): ReadonlyMap<string, number> {
	const usage = new Map(document.natures.map(({ id }) => [id, 0]));
	for (const node of document.nodes) usage.set(node.natureId, (usage.get(node.natureId) ?? 0) + 1);
	return usage;
}

export enum NatureRemovalKind {
	/** No box uses the nature: it goes without further choice. */
	Free = 'free',
	/** Used boxes move to one of the candidates, chosen by the author. */
	Reassign = 'reassign',
	/** Used, and no other nature exists to receive the boxes. */
	Blocked = 'blocked',
}

interface FreeNatureRemoval {
	readonly kind: NatureRemovalKind.Free;
}

interface ReassigningNatureRemoval {
	readonly kind: NatureRemovalKind.Reassign;
	readonly candidates: readonly LogicNature[];
}

interface BlockedNatureRemoval {
	readonly kind: NatureRemovalKind.Blocked;
}

export type NatureRemoval = FreeNatureRemoval | ReassigningNatureRemoval | BlockedNatureRemoval;

export function natureRemoval(
	natures: readonly LogicNature[],
	usage: ReadonlyMap<string, number>,
	natureId: string,
): NatureRemoval {
	if ((usage.get(natureId) ?? 0) === 0) return { kind: NatureRemovalKind.Free };
	const candidates = natures.filter(({ id }) => id !== natureId);
	if (candidates.length === 0) return { kind: NatureRemovalKind.Blocked };
	return { kind: NatureRemovalKind.Reassign, candidates };
}
