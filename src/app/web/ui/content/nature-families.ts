import { type NatureFamily, NatureFamilyId } from '../../../../lib/core/document/nature-families';
import { m } from '../../i18n/paraglide/messages';

const NAMES: Readonly<Record<NatureFamilyId, () => string>> = {
	[NatureFamilyId.Generic]: m.editing_nature_family_generic,
	[NatureFamilyId.GoalTree]: m.editing_nature_family_goal_tree,
	[NatureFamilyId.RetroKds]: m.editing_nature_family_retro_kds,
};

/** A family's name in the request locale; natures of no known family share one name. */
export function natureFamilyName(family: NatureFamily | undefined): string {
	if (family === undefined) return m.editing_nature_family_none();
	return NAMES[family.id]();
}
