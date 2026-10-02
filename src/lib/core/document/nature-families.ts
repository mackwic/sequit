import { compareCanonicalStrings } from '../canonical-string';
import type { LogicNature } from './logic-document';

/** The predefined families, as natures record them in their `family` field. */
export enum NatureFamilyId {
	Generic = 'generic',
	GoalTree = 'goal-tree',
	RetroKds = 'retro-kds',
}

/** A predefined set of natures an author adds to a document's library in one step. */
export interface NatureFamily {
	readonly id: NatureFamilyId;
	readonly natures: readonly LogicNature[];
}

function defineFamily(family: NatureFamilyId, natures: readonly LogicNature[]): NatureFamily {
	return { id: family, natures: natures.map((nature) => ({ ...nature, family })) };
}

/**
 * In display order. Labels are content, like any nature's: they are never translated. Each family
 * owns its identifiers, so two families may both hold a « Question ».
 */
export const NATURE_FAMILIES: readonly NatureFamily[] = [
	defineFamily(NatureFamilyId.Generic, [
		{ id: 'node', label: 'Node', color: '#64748b' },
		{ id: 'comment', label: 'Comment', color: '#eab308', icon: 'phosphor:chat-circle' },
		{ id: 'problem', label: 'Problem', color: '#ef4444', icon: 'phosphor:warning' },
		{ id: 'idea', label: 'Idea', color: '#22c55e', icon: 'phosphor:lightbulb' },
		{ id: 'question', label: 'Question', color: '#8b5cf6', icon: 'phosphor:question' },
	]),
	defineFamily(NatureFamilyId.GoalTree, [
		{ id: 'goal', label: 'Goal', color: '#12c930', icon: 'phosphor:target' },
		{ id: 'need', label: 'Need', color: '#f4c400', icon: 'phosphor:flag' },
		{ id: 'want', label: 'Want', color: '#ed58c7', icon: 'phosphor:heart' },
		{ id: 'solution', label: 'Solution', color: '#6f70e8', icon: 'phosphor:lightbulb' },
		{ id: 'precondition', label: 'Precondition', color: '#8981ec', icon: 'phosphor:key' },
		{
			id: 'desirable-effect',
			label: 'Desirable Effect',
			color: '#62c985',
			icon: 'phosphor:sparkle',
		},
		{ id: 'note', label: 'Note', color: '#f2ea20', icon: 'phosphor:note' },
	]),
	defineFamily(NatureFamilyId.RetroKds, [
		{ id: 'keep', label: 'Keep', color: '#22c55e', icon: 'phosphor:check-circle' },
		{ id: 'drop', label: 'Drop', color: '#ef4444', icon: 'phosphor:x-circle' },
		{ id: 'start', label: 'Start', color: '#3b82f6', icon: 'phosphor:rocket-launch' },
		{ id: 'retro-question', label: 'Question', color: '#8b5cf6', icon: 'phosphor:question' },
	]),
];

/** The library every new document starts with. */
export function defaultNatures(): readonly LogicNature[] {
	return NATURE_FAMILIES.find(({ id }) => id === NatureFamilyId.Generic)?.natures ?? [];
}

/** The family's natures the library lacks, by identifier, in family order. */
export function missingFamilyNatures(
	library: readonly LogicNature[],
	family: NatureFamily,
): readonly LogicNature[] {
	const ids = new Set(library.map(({ id }) => id));
	return family.natures.filter(({ id }) => !ids.has(id));
}

/** The library's natures that share an identifier with the family's but belong to no family. */
export function adoptableFamilyNatures(
	library: readonly LogicNature[],
	family: NatureFamily,
): readonly LogicNature[] {
	const ids = new Set(family.natures.map(({ id }) => id));
	return library.filter((nature) => nature.family === undefined && ids.has(nature.id));
}

const FAMILY_IDS = new Set<string>(Object.values(NatureFamilyId));

/** Whether a nature's family is one of the predefined ones, rather than absent or unknown. */
export function isNatureFamilyId(family: string): family is NatureFamilyId {
	return FAMILY_IDS.has(family);
}

/** Natures sharing a family; `family` is absent for those of no known family. */
export interface NatureFamilyGroup {
	readonly family?: NatureFamily;
	readonly natures: readonly LogicNature[];
}

function byLabel(left: LogicNature, right: LogicNature): number {
	return (
		compareCanonicalStrings(left.label.toLowerCase(), right.label.toLowerCase()) ||
		compareCanonicalStrings(left.id, right.id)
	);
}

function familyOrder(family: NatureFamily): (left: LogicNature, right: LogicNature) => number {
	const rank = (nature: LogicNature): number => {
		const index = family.natures.findIndex(({ id }) => id === nature.id);
		if (index === -1) return family.natures.length;
		return index;
	};
	return (left, right) => rank(left) - rank(right) || byLabel(left, right);
}

/**
 * The library grouped by family for display: predefined families in catalogue order, each in its
 * own order then by label, and last the natures of no or of an unknown family, by label.
 */
export function natureFamilyGroups(natures: readonly LogicNature[]): readonly NatureFamilyGroup[] {
	const groups: NatureFamilyGroup[] = [];
	for (const family of NATURE_FAMILIES) {
		const members = natures.filter((nature) => nature.family === family.id);
		if (members.length > 0) groups.push({ family, natures: members.sort(familyOrder(family)) });
	}
	const others = natures.filter(({ family }) => family === undefined || !isNatureFamilyId(family));
	if (others.length > 0) groups.push({ natures: others.sort(byLabel) });
	return groups;
}

/** The first nature as the library is shown, which new boxes take until another is chosen. */
export function firstNature(natures: readonly LogicNature[]): LogicNature | undefined {
	return natureFamilyGroups(natures)[0]?.natures[0];
}
