import type { RoutePalette } from './route-color-palette';

type Family = ReadonlySet<string>;

interface ClusterColorInput {
	readonly families: readonly Family[];
	readonly contacts: ReadonlyMap<Family, ReadonlySet<Family>>;
	readonly continuities: ReadonlyMap<Family, ReadonlySet<Family>>;
	readonly palette: RoutePalette;
}

interface ColorCluster {
	readonly families: readonly Family[];
	offset: number;
	aligned: boolean;
}

interface AlignmentInput {
	readonly byFamily: ReadonlyMap<Family, ColorCluster>;
	readonly paletteSize: number;
}

function familyKey(family: Family): string {
	return [...family].sort().join('\u0000');
}

function orderedFamilies(families: Iterable<Family>): Family[] {
	return [...families].sort((left, right) => {
		const a = familyKey(left);
		const b = familyKey(right);
		return Number(a > b) - Number(a < b);
	});
}

function collectComponent(
	first: Family,
	remaining: Set<Family>,
	contacts: ReadonlyMap<Family, ReadonlySet<Family>>,
): Family[] {
	const members = new Set<Family>([first]);
	const pending = [first];
	for (const family of pending) {
		for (const neighbor of contacts.get(family) ?? []) {
			if (!remaining.delete(neighbor)) continue;
			members.add(neighbor);
			pending.push(neighbor);
		}
	}
	return orderedFamilies(members);
}

function contactClusters(input: ClusterColorInput): ColorCluster[] {
	const remaining = new Set(input.families);
	const clusters: ColorCluster[] = [];
	for (const first of orderedFamilies(input.families)) {
		if (!remaining.delete(first)) continue;
		const families = collectComponent(first, remaining, input.contacts);
		clusters.push({ families, offset: 0, aligned: false });
	}
	return clusters;
}

function positiveModulo(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor;
}

function alignNeighbor(
	current: ColorCluster,
	family: Family,
	neighbor: Family,
	input: AlignmentInput,
): ColorCluster | undefined {
	const next = input.byFamily.get(neighbor);
	if (next === undefined) return undefined;
	if (next === current) return undefined;
	if (next.aligned) return undefined;
	const here = current.families.indexOf(family);
	const there = next.families.indexOf(neighbor);
	const alignment = current.offset + here - there;
	next.offset = positiveModulo(alignment, input.paletteSize);
	next.aligned = true;
	return next;
}

function alignedNeighbors(
	current: ColorCluster,
	continuities: ReadonlyMap<Family, ReadonlySet<Family>>,
	input: AlignmentInput,
): ColorCluster[] {
	const result: ColorCluster[] = [];
	for (const family of current.families) {
		for (const neighbor of orderedFamilies(continuities.get(family) ?? [])) {
			const next = alignNeighbor(current, family, neighbor, input);
			if (next !== undefined) result.push(next);
		}
	}
	return result;
}

function alignCluster(
	cluster: ColorCluster,
	byFamily: ReadonlyMap<Family, ColorCluster>,
	input: ClusterColorInput,
): void {
	const pending = [cluster];
	const alignment = { byFamily, paletteSize: input.palette.length };
	cluster.aligned = true;
	for (const current of pending) {
		pending.push(...alignedNeighbors(current, input.continuities, alignment));
	}
}

/** Contact components restart the palette; aligned quays propagate a rotation between components. */
export function clusterColors(input: ClusterColorInput): ReadonlyMap<Family, string> {
	const clusters = contactClusters(input);
	const byFamily = new Map(
		clusters.flatMap((cluster) => cluster.families.map((family) => [family, cluster])),
	);
	for (const cluster of clusters) {
		if (!cluster.aligned) alignCluster(cluster, byFamily, input);
	}
	return new Map(
		clusters.flatMap((cluster) =>
			cluster.families.map((family, index) => {
				const paletteIndex = (cluster.offset + index) % input.palette.length;
				const color = input.palette.at(paletteIndex) ?? input.palette[0];
				return [family, color];
			}),
		),
	);
}
