import {
	contentStyleFields,
	type LogicDocument,
	type LogicNature,
	natureFamilyField,
} from '../../core/document/logic-document';
import {
	adoptableFamilyNatures,
	missingFamilyNatures,
	type NatureFamily,
} from '../../core/document/nature-families';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
	SharedProperty,
} from './shared-document-command';

/** What an author edits in the nature dialog; `''` means no icon, or no family. */
export interface NatureFields {
	readonly label: string;
	readonly color: string;
	readonly icon: string;
	readonly family: string;
}

/** A nature without an icon and one that hides it explicitly both edit as no icon. */
export function natureFields(nature: LogicNature): NatureFields {
	let icon = nature.icon ?? '';
	if (icon === 'none') icon = '';
	return { label: nature.label, color: nature.color, icon, family: nature.family ?? '' };
}

export function natureCreation(id: string, fields: NatureFields): SharedDocumentCommand {
	return {
		op: SharedCommandKind.Create,
		target: { kind: SharedElementKind.Nature, id },
		properties: {
			label: fields.label.trim(),
			color: fields.color,
			...contentStyleFields(undefined, fields.icon || undefined),
			...natureFamilyField(fields.family || undefined),
		},
	};
}

/**
 * One batch adding the family's natures the library lacks and filing in the family those it
 * already holds without one, such as an older copy of the same library; empty when nothing changes.
 */
export function natureFamilyImport(
	library: readonly LogicNature[],
	family: NatureFamily,
): readonly SharedDocumentCommand[] {
	const created = missingFamilyNatures(library, family).map((nature) =>
		natureCreation(nature.id, natureFields(nature)),
	);
	const filed = adoptableFamilyNatures(library, family).map(({ id }): SharedDocumentCommand => ({
		op: SharedCommandKind.Update,
		target: { kind: SharedElementKind.Nature, id },
		set: { family: family.id },
		unset: [],
	}));
	return [...created, ...filed];
}

/** Properties a nature may lack; an empty field removes them. */
const OPTIONAL_PROPERTIES = [SharedProperty.Icon, SharedProperty.Family] as const;

/** The label is a text: callers splice it through `updateText`; the other fields travel here. */
export function natureUpdate(
	natureId: string,
	before: NatureFields,
	after: NatureFields,
): SharedDocumentCommand | undefined {
	const set: { color?: string; icon?: string; family?: string } = {};
	const unset: (typeof OPTIONAL_PROPERTIES)[number][] = [];
	if (before.color !== after.color) set.color = after.color;
	for (const property of OPTIONAL_PROPERTIES) {
		const value = after[property];
		if (value === before[property]) continue;
		if (value === '') unset.push(property);
		else set[property] = value;
	}
	if (unset.length === 0 && Object.keys(set).length === 0) return undefined;
	const target = { kind: SharedElementKind.Nature, id: natureId } as const;
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

/** The nature shown once one is removed: its replacement, otherwise the first one left. */
export function natureAfterRemoval(
	natures: readonly LogicNature[],
	removedId: string,
	replacementId: string | undefined,
): LogicNature | undefined {
	const left = natures.filter(({ id }) => id !== removedId);
	return left.find(({ id }) => id === replacementId) ?? left[0];
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

const NEW_NATURE: NatureFields = { label: '', color: '#6f70e8', icon: '', family: '' };

/** A blank nature, in the given family when there is one. */
export function newNatureEditing(id: string, family = ''): NatureEditing {
	const fields = { ...NEW_NATURE, family };
	return { id, mode: NatureEditingMode.Create, base: fields, draft: fields };
}

export function natureEditing(nature: LogicNature): NatureEditing {
	const fields = natureFields(nature);
	return { id: nature.id, mode: NatureEditingMode.Edit, base: fields, draft: fields };
}

/** Whether saving the form would change anything; a label differing only by spaces does not. */
export function natureDraftChanged({ base, draft }: NatureEditing): boolean {
	if (draft.label.trim() !== base.label) return true;
	if (draft.color !== base.color) return true;
	return draft.icon !== base.icon || draft.family !== base.family;
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
