import type { EffectiveSemanticRelation } from '../graph/create-graph';

export type VisualLayerKey = `${number}:${'ordinary' | 'junction'}`;

export interface CrossingOrderMetadata {
	readonly effectiveRelations: readonly EffectiveSemanticRelation[];
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

interface IndexedEndpoint {
	readonly id: string;
	readonly ordinal: number;
}

interface IndexedRelation {
	readonly relationId: string;
	readonly sourceByLayer: ReadonlyMap<VisualLayerKey, readonly IndexedEndpoint[]>;
	readonly targetByLayer: ReadonlyMap<VisualLayerKey, readonly IndexedEndpoint[]>;
	readonly pairWeight: number;
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

function indexRelations(metadata: CrossingOrderMetadata): readonly IndexedRelation[] {
	const ordinalsByLayer = new Map<VisualLayerKey, Map<string, number>>();
	for (const id of metadata.effectiveEndpointOrder) {
		const layer = visualLayerKey(id, metadata.ranks, metadata.junctionIds);
		if (layer === undefined) continue;
		const ordinals = ordinalsByLayer.get(layer) ?? new Map<string, number>();
		ordinals.set(id, ordinals.size);
		ordinalsByLayer.set(layer, ordinals);
	}
	function byLayer(
		ids: readonly string[],
	): ReadonlyMap<VisualLayerKey, readonly IndexedEndpoint[]> {
		const result = new Map<VisualLayerKey, IndexedEndpoint[]>();
		for (const id of ids) {
			const layer = visualLayerKey(id, metadata.ranks, metadata.junctionIds);
			const ordinal = layer === undefined ? undefined : ordinalsByLayer.get(layer)?.get(id);
			if (layer === undefined || ordinal === undefined) continue;
			const endpoints = result.get(layer) ?? [];
			endpoints.push({ id, ordinal });
			result.set(layer, endpoints);
		}
		for (const endpoints of result.values())
			endpoints.sort((left, right) => left.ordinal - right.ordinal);
		return result;
	}
	return metadata.effectiveRelations.map((relation) => ({
		relationId: relation.relationId,
		sourceByLayer: byLayer(relation.sourceIds),
		targetByLayer: byLayer(relation.targetIds),
		pairWeight: 1 / (relation.sourceIds.length * relation.targetIds.length),
	}));
}

function inversionCounts(
	left: readonly IndexedEndpoint[],
	right: readonly IndexedEndpoint[],
): readonly [less: number, greater: number] {
	let less = 0;
	let greater = 0;
	let rightBelow = 0;
	let rightAtOrBelow = 0;
	for (const leftEndpoint of left) {
		while (rightBelow < right.length && right[rightBelow].ordinal < leftEndpoint.ordinal)
			rightBelow += 1;
		if (rightAtOrBelow < rightBelow) rightAtOrBelow = rightBelow;
		while (rightAtOrBelow < right.length && right[rightAtOrBelow].ordinal <= leftEndpoint.ordinal)
			rightAtOrBelow += 1;
		greater += rightBelow;
		less += right.length - rightAtOrBelow;
	}
	return [less, greater];
}

function accumulateSideCosts(
	moving: IndexedRelation,
	other: IndexedRelation,
	targetId: string,
	targetAtSource: boolean,
	peerIndex: ReadonlyMap<string, number>,
	beforeByPeer: number[],
	afterByPeer: number[],
): void {
	const movingSide = targetAtSource ? moving.sourceByLayer : moving.targetByLayer;
	const movingOpposite = targetAtSource ? moving.targetByLayer : moving.sourceByLayer;
	const otherSide = targetAtSource ? other.sourceByLayer : other.targetByLayer;
	const otherOpposite = targetAtSource ? other.targetByLayer : other.sourceByLayer;
	for (const [layer, movingEndpoints] of movingSide) {
		if (!movingEndpoints.some(({ id }) => id === targetId)) continue;
		const peers = otherSide.get(layer);
		if (!peers) continue;
		for (const [oppositeLayer, targetOpposites] of movingOpposite) {
			const peerOpposites = otherOpposite.get(oppositeLayer);
			if (!peerOpposites) continue;
			for (const peer of peers) {
				const index = peerIndex.get(peer.id);
				if (index === undefined) continue;
				let lower = 0;
				let higher = 0;
				for (const targetOpposite of targetOpposites) {
					for (const peerOpposite of peerOpposites) {
						if (targetOpposite.ordinal < peerOpposite.ordinal) lower += 1;
						if (targetOpposite.ordinal > peerOpposite.ordinal) higher += 1;
					}
				}
				const weight = moving.pairWeight * other.pairWeight;
				beforeByPeer[index] = (beforeByPeer[index] ?? 0) + higher * weight;
				afterByPeer[index] = (afterByPeer[index] ?? 0) + lower * weight;
			}
		}
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
	const relations = indexRelations(metadata);
	for (const moving of relations) {
		for (const other of relations) {
			if (moving.relationId === other.relationId) continue;
			accumulateSideCosts(moving, other, targetId, true, peerIndex, beforeByPeer, afterByPeer);
			accumulateSideCosts(moving, other, targetId, false, peerIndex, beforeByPeer, afterByPeer);
		}
	}

	const scoreBySlot: number[] = [];
	let score = beforeByPeer.reduce((total, value) => total + value, 0);
	for (let slot = 0; slot <= peers.length; slot += 1) {
		scoreBySlot.push(score);
		if (slot < peers.length) score += (afterByPeer[slot] ?? 0) - (beforeByPeer[slot] ?? 0);
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
	const relations = indexRelations(metadata);
	for (const [index, left] of relations.entries()) {
		for (const right of relations.slice(index + 1)) {
			if (left.relationId === right.relationId) continue;
			for (const [sourceLayer, leftSources] of left.sourceByLayer) {
				const rightSources = right.sourceByLayer.get(sourceLayer);
				if (!rightSources) continue;
				const [sourceLess, sourceGreater] = inversionCounts(leftSources, rightSources);
				for (const [targetLayer, leftTargets] of left.targetByLayer) {
					const rightTargets = right.targetByLayer.get(targetLayer);
					if (!rightTargets) continue;
					const [targetLess, targetGreater] = inversionCounts(leftTargets, rightTargets);
					score +=
						(sourceLess * targetGreater + sourceGreater * targetLess) *
						left.pairWeight *
						right.pairWeight;
				}
			}
		}
	}
	return score;
}
