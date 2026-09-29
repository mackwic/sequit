import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import {
	familiesAroundGroup,
	familyBeneathMember,
	familyBesideGroup,
	familySplitByGroup,
} from '../../../support/fixtures/group-families';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { VisualLayout } from '../../../support/harnesses/visual-layout';
import type { LayoutScenario } from '../scenario';

/** A foreign box keeps the rail clearance along the flow and the item gap beside the frame. */
const FRAME_CLEARANCE = { along: 48, across: 36 };

/** Children and the parents whose envelope they are centered on. */
type Family = readonly [children: readonly string[], parents: string | readonly string[]];

function centersFamilies(layout: VisualLayout, families: readonly Family[]): void {
	const check = AssertLayout(layout);
	for (const [children, parents] of families)
		check
			.envelope(children)
			.isCenteredOn(layout.envelopeOf([parents].flat()), { axis: 'transverse' });
}

const BESIDE_FAMILIES: readonly Family[] = [
	[['c1', 'c2', 'c3'], 'p'],
	[['d1', 'd2'], 'c1'],
	[['d3'], 'c2'],
	[['d4', 'd5'], 'c3'],
];

const beside: LayoutScenario = {
	id: 'group-family-beside',
	label: 'Groupe à côté : la descendance reste sous son parent',
	group: 'Groupes et familles',
	order: 610,
	expectedFailure: true,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		const { data, groups } = familyBesideGroup(direction);
		return layoutNodes({ ...data, direction, bias, groups });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.group('g').isClearOfForeignBoxes(FRAME_CLEARANCE);
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow().haveNoCrossing();
		centersFamilies(layout, BESIDE_FAMILIES);
	},
};

const beneathMember: LayoutScenario = {
	id: 'group-family-beneath-member',
	label: 'Groupe au-dessus : des enfants pointent vers un membre',
	group: 'Groupes et familles',
	order: 630,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		const { data, groups } = familyBeneathMember(direction);
		return layoutNodes({ ...data, direction, bias, groups });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.group('w').isClearOfForeignBoxes(FRAME_CLEARANCE);
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow().haveNoCrossing();
		centersFamilies(layout, [[['k1', 'k2'], 'w4']]);
	},
};

const around: LayoutScenario = {
	id: 'group-family-around',
	label: 'Groupe au milieu : parents hors groupe de part et d’autre',
	group: 'Groupes et familles',
	order: 640,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		const { data, groups } = familiesAroundGroup(direction);
		return layoutNodes({ ...data, direction, bias, groups });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.group('g').isClearOfForeignBoxes(FRAME_CLEARANCE);
		check.group('g').isAfter('l', { direction: 'transverse-positive' });
		check.node('r').isAfter('g', { direction: 'transverse-positive' });
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow().haveNoCrossing();
		centersFamilies(layout, [
			[['l0', 'g', 'r0'], 't'],
			[['l'], 'l0'],
			[['r'], 'r0'],
			[['l1', 'l2'], 'l'],
			[['m1', 'm2'], 'm'],
			[['r1', 'r2'], 'r'],
		]);
	},
};

const split: LayoutScenario = {
	id: 'group-family-split',
	label: 'Famille coupée par un groupe : l’enveloppe inclut le bloc',
	group: 'Groupes et familles',
	order: 650,
	expectedFailure: true,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		const { data, groups } = familySplitByGroup(direction);
		return layoutNodes({ ...data, direction, bias, groups });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.group('g').isClearOfForeignBoxes(FRAME_CLEARANCE);
		check.group('g').isAfter('a', { direction: 'transverse-positive' });
		check.node('c').isAfter('g', { direction: 'transverse-positive' });
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow().haveNoCrossing();
		centersFamilies(layout, [[['a', 'g', 'c'], 'p']]);
	},
};

const ungrouped: LayoutScenario = {
	id: 'group-family-ungrouped',
	label: 'Sans groupe : le même graphe garde l’alignement actuel',
	group: 'Groupes et familles',
	order: 660,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		const { data, groups } = familyBesideGroup(direction, false);
		return layoutNodes({ ...data, direction, bias, groups });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow().haveNoCrossing();
		centersFamilies(layout, [...BESIDE_FAMILIES, [['g2', 'p'], 'g1'], [['g3', 'g4'], 'g2']]);
	},
};

export const scenario: LayoutScenario = {
	...beside,
	id: 'group-family-alignment',
	label: 'Familles et groupes : ne pas partager les rangées à travers un groupe',
	variants: [beside, beneathMember, around, split, ungrouped],
};
