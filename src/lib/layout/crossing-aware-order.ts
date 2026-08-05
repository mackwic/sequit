import type { EffectiveGraphLink } from '../graph/create-graph';

export type VisualLayerKey = `${number}:${'ordinary' | 'junction'}`;

export interface CrossingOrderMetadata {
	readonly effectiveLinks: readonly EffectiveGraphLink[];
	readonly effectiveEndpointOrder: readonly string[];
	readonly ranks: ReadonlyMap<string, number>;
	readonly junctionIds: ReadonlySet<string>;
}

export interface TargetSlotScores {
	readonly currentSlot: number;
	readonly beforeByPeer: readonly number[];
	readonly afterByPeer: readonly number[];
	readonly scoreBySlot: readonly number[];
}

export interface TargetSlotSelection extends TargetSlotScores {
	readonly bestSlot: number;
	readonly bestScore: number;
	readonly currentScore: number;
	readonly order: readonly string[];
	readonly moved: boolean;
}

export function crossingScoreTolerance(left: number, right: number): number {
	return Number.EPSILON * 16 * Math.max(1, Math.abs(left), Math.abs(right));
}

interface IndexedLink extends EffectiveGraphLink {
	readonly sourceLayer: VisualLayerKey;
	readonly targetLayer: VisualLayerKey;
	readonly sourceOrdinal: number;
	readonly targetOrdinal: number;
}

interface LinkBucket {
	readonly sourceLayer: VisualLayerKey;
	readonly targetLayer: VisualLayerKey;
	readonly links: IndexedLink[];
}

export function visualLayerKey(
	endpointId: string,
	ranks: ReadonlyMap<string, number>,
	junctionIds: ReadonlySet<string>,
): VisualLayerKey | undefined {
	const rank = ranks.get(endpointId);
	return rank === undefined
		? undefined
		: `${rank}:${junctionIds.has(endpointId) ? 'junction' : 'ordinary'}`;
}

function indexLinks(metadata: CrossingOrderMetadata): readonly LinkBucket[] {
	const idsByLayer = new Map<VisualLayerKey, string[]>();
	for (const id of metadata.effectiveEndpointOrder) {
		const layer = visualLayerKey(id, metadata.ranks, metadata.junctionIds);
		if (layer === undefined) continue;
		const ids = idsByLayer.get(layer) ?? [];
		ids.push(id);
		idsByLayer.set(layer, ids);
	}
	const ordinalsByLayer = new Map(
		[...idsByLayer].map(([layer, ids]) => [
			layer,
			new Map(ids.map((id, ordinal) => [id, ordinal])),
		]),
	);
	const buckets = new Map<string, LinkBucket>();
	for (const link of metadata.effectiveLinks) {
		const sourceLayer = visualLayerKey(link.sourceId, metadata.ranks, metadata.junctionIds);
		const targetLayer = visualLayerKey(link.targetId, metadata.ranks, metadata.junctionIds);
		const sourceOrdinal = sourceLayer && ordinalsByLayer.get(sourceLayer)?.get(link.sourceId);
		const targetOrdinal = targetLayer && ordinalsByLayer.get(targetLayer)?.get(link.targetId);
		if (
			sourceLayer === undefined ||
			targetLayer === undefined ||
			sourceOrdinal === undefined ||
			targetOrdinal === undefined
		) {
			continue;
		}
		const key = `${sourceLayer}->${targetLayer}`;
		const bucket = buckets.get(key) ?? { sourceLayer, targetLayer, links: [] };
		bucket.links.push({ ...link, sourceLayer, targetLayer, sourceOrdinal, targetOrdinal });
		buckets.set(key, bucket);
	}
	return [...buckets.values()];
}

function accumulateSideCosts(
	bucket: LinkBucket,
	targetId: string,
	targetAtSource: boolean,
	peerIndex: ReadonlyMap<string, number>,
	beforeByPeer: number[],
	afterByPeer: number[],
): void {
	const targetLinks = bucket.links.filter((link) =>
		targetAtSource ? link.sourceId === targetId : link.targetId === targetId,
	);
	if (targetLinks.length === 0) return;
	const oppositeOrdinals = targetLinks.map((link) =>
		targetAtSource ? link.targetOrdinal : link.sourceOrdinal,
	);
	const maximumOrdinal = Math.max(0, ...oppositeOrdinals);
	const weightAtOrdinal = Array.from({ length: maximumOrdinal + 1 }, () => 0);
	for (const link of targetLinks) {
		const ordinal = targetAtSource ? link.targetOrdinal : link.sourceOrdinal;
		weightAtOrdinal[ordinal] = (weightAtOrdinal[ordinal] ?? 0) + link.weight;
	}
	const weightBeforeOrdinal = Array.from({ length: weightAtOrdinal.length }, () => 0);
	let totalWeight = 0;
	for (const [ordinal, weight] of weightAtOrdinal.entries()) {
		weightBeforeOrdinal[ordinal] = totalWeight;
		totalWeight += weight;
	}

	for (const link of bucket.links) {
		const movingEndpointId = targetAtSource ? link.sourceId : link.targetId;
		if (movingEndpointId === targetId) continue;
		const index = peerIndex.get(movingEndpointId);
		if (index === undefined) continue;
		const oppositeOrdinal = targetAtSource ? link.targetOrdinal : link.sourceOrdinal;
		const lowerWeight = weightBeforeOrdinal[oppositeOrdinal] ?? totalWeight;
		const equalWeight = weightAtOrdinal[oppositeOrdinal] ?? 0;
		const higherWeight = totalWeight - lowerWeight - equalWeight;
		beforeByPeer[index] = (beforeByPeer[index] ?? 0) + higherWeight * link.weight;
		afterByPeer[index] = (afterByPeer[index] ?? 0) + lowerWeight * link.weight;
	}
}

export function scoreTargetInsertionSlots(
	row: readonly string[],
	targetId: string,
	metadata: CrossingOrderMetadata,
): TargetSlotScores {
	const currentSlot = row.indexOf(targetId);
	if (currentSlot < 0 || row.lastIndexOf(targetId) !== currentSlot) {
		throw new Error(`Target must occur exactly once in its visual row: ${targetId}`);
	}
	const peers = row.filter((id) => id !== targetId);
	const peerIndex = new Map(peers.map((id, index) => [id, index]));
	const beforeByPeer = peers.map(() => 0);
	const afterByPeer = peers.map(() => 0);
	for (const bucket of indexLinks(metadata)) {
		accumulateSideCosts(bucket, targetId, true, peerIndex, beforeByPeer, afterByPeer);
		accumulateSideCosts(bucket, targetId, false, peerIndex, beforeByPeer, afterByPeer);
	}

	const scoreBySlot: number[] = [];
	let score = beforeByPeer.reduce((total, value) => total + value, 0);
	for (let slot = 0; slot <= peers.length; slot += 1) {
		scoreBySlot.push(score);
		if (slot < peers.length) {
			score += (afterByPeer[slot] ?? 0) - (beforeByPeer[slot] ?? 0);
		}
	}
	return { currentSlot, beforeByPeer, afterByPeer, scoreBySlot };
}

export function selectTargetInsertionSlot(
	row: readonly string[],
	targetId: string,
	metadata: CrossingOrderMetadata,
): TargetSlotSelection {
	const scores = scoreTargetInsertionSlots(row, targetId, metadata);
	const minimumScore = Math.min(...scores.scoreBySlot);
	let bestSlot: number | undefined;
	for (const [slot, score] of scores.scoreBySlot.entries()) {
		if (Math.abs(score - minimumScore) > crossingScoreTolerance(score, minimumScore)) continue;
		if (
			bestSlot === undefined ||
			Math.abs(slot - scores.currentSlot) < Math.abs(bestSlot - scores.currentSlot) ||
			(Math.abs(slot - scores.currentSlot) === Math.abs(bestSlot - scores.currentSlot) &&
				slot < bestSlot)
		)
			bestSlot = slot;
	}
	if (bestSlot === undefined)
		throw new Error('Target insertion scores must contain a finite minimum');
	const bestScore = scores.scoreBySlot[bestSlot] ?? 0;
	const peers = row.filter((id) => id !== targetId);
	const order = [...peers.slice(0, bestSlot), targetId, ...peers.slice(bestSlot)];
	return {
		...scores,
		bestSlot,
		bestScore,
		currentScore: scores.scoreBySlot[scores.currentSlot] ?? 0,
		order,
		moved: bestSlot !== scores.currentSlot,
	};
}

export function weightedInversionScore(metadata: CrossingOrderMetadata): number {
	let score = 0;
	for (const bucket of indexLinks(metadata)) {
		for (const [index, left] of bucket.links.entries()) {
			for (const right of bucket.links.slice(index + 1)) {
				if (
					(left.sourceOrdinal - right.sourceOrdinal) * (left.targetOrdinal - right.targetOrdinal) <
					0
				) {
					score += left.weight * right.weight;
				}
			}
		}
	}
	return score;
}
