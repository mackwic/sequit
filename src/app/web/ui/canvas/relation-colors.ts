import type { LayoutRelation } from '../../projection/layout-graph';

const COLORS = [
	'var(--content-relation-1)',
	'var(--content-relation-2)',
	'var(--content-relation-3)',
	'var(--content-relation-4)',
] as const;

function quayKeys(relation: LayoutRelation): readonly string[] {
	return [
		JSON.stringify([relation.from, 'out', relation.points.at(0)]),
		JSON.stringify([relation.to, 'in', relation.points.at(-1)]),
	];
}

function intersects(previous: ReadonlySet<string>, family: ReadonlySet<string>): boolean {
	return [...previous].some((member) => family.has(member));
}

function mergeFamilies(families: Map<string, Set<string>>, family: Set<string>): void {
	for (const [key, previous] of families) {
		if (intersects(previous, family)) families.set(key, family);
	}
}

/** Relations sharing an endpoint quay keep the same ink along their common trunk. */
export function relationColors(relations: readonly LayoutRelation[]): ReadonlyMap<string, string> {
	const families = new Map<string, Set<string>>();
	const byId = new Map<string, Set<string>>();
	const ordered = [...relations].sort((left, right) => left.id.localeCompare(right.id));
	for (const relation of ordered) {
		const keys = quayKeys(relation);
		const family = new Set([relation.id]);
		for (const key of keys) {
			for (const member of families.get(key) ?? []) family.add(member);
		}
		mergeFamilies(families, family);
		for (const key of keys) families.set(key, family);
		for (const member of family) byId.set(member, family);
	}
	const colors = new Map<Set<string>, string>();
	const result = new Map<string, string>();
	for (const [id, family] of byId) {
		const color = colors.get(family) ?? COLORS[colors.size % COLORS.length] ?? COLORS[0];
		colors.set(family, color);
		result.set(id, color);
	}
	return result;
}
