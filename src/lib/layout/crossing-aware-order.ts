import type { EffectiveSemanticRelation } from '../graph/create-graph';

enum VisualLayerKind {
	Ordinary = 'ordinary',
	Junction = 'junction',
}

export type VisualLayerKey = `${number}:${VisualLayerKind}`;

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
	if (rank === undefined) return undefined;
	let kind = VisualLayerKind.Ordinary;
	if (junctionIds.has(endpointId)) kind = VisualLayerKind.Junction;
	return `${rank}:${kind}`;
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
			let ordinal: number | undefined;
			if (layer !== undefined) ordinal = ordinalsByLayer.get(layer)?.get(id);
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
		while (rightBelow < right.length) {
			const rightEndpoint = right[rightBelow];
			if (rightEndpoint === undefined || rightEndpoint.ordinal >= leftEndpoint.ordinal) break;
			rightBelow += 1;
		}
		if (rightAtOrBelow < rightBelow) rightAtOrBelow = rightBelow;
		while (rightAtOrBelow < right.length) {
			const rightEndpoint = right[rightAtOrBelow];
			if (rightEndpoint === undefined || rightEndpoint.ordinal > leftEndpoint.ordinal) break;
			rightAtOrBelow += 1;
		}
		greater += rightBelow;
		less += right.length - rightAtOrBelow;
	}
	return [less, greater];
}

interface SideCostContext {
	readonly targetId: string;
	readonly peerIndex: ReadonlyMap<string, number>;
	readonly beforeByPeer: number[];
	readonly afterByPeer: number[];
}

interface RelationSides {
	readonly side: ReadonlyMap<VisualLayerKey, readonly IndexedEndpoint[]>;
	readonly opposite: ReadonlyMap<VisualLayerKey, readonly IndexedEndpoint[]>;
}

function relationSides(relation: IndexedRelation, source: boolean): RelationSides {
	if (source) return { side: relation.sourceByLayer, opposite: relation.targetByLayer };
	return { side: relation.targetByLayer, opposite: relation.sourceByLayer };
}

function oppositeOrdinalCounts(
	targetOpposites: readonly IndexedEndpoint[],
	peerOpposites: readonly IndexedEndpoint[],
): readonly [lower: number, higher: number] {
	let lower = 0;
	let higher = 0;
	for (const targetOpposite of targetOpposites) {
		for (const peerOpposite of peerOpposites) {
			if (targetOpposite.ordinal < peerOpposite.ordinal) lower += 1;
			if (targetOpposite.ordinal > peerOpposite.ordinal) higher += 1;
		}
	}
	return [lower, higher];
}

function addPeerCosts(
	peers: readonly IndexedEndpoint[],
	counts: readonly [lower: number, higher: number],
	weight: number,
	context: SideCostContext,
): void {
	const [lower, higher] = counts;
	for (const peer of peers) {
		const index = context.peerIndex.get(peer.id);
		if (index === undefined) continue;
		const higherCost = higher * weight;
		const lowerCost = lower * weight;
		context.beforeByPeer[index] = (context.beforeByPeer[index] ?? 0) + higherCost;
		context.afterByPeer[index] = (context.afterByPeer[index] ?? 0) + lowerCost;
	}
}

function accumulateSideCosts(
	moving: IndexedRelation,
	other: IndexedRelation,
	targetAtSource: boolean,
	context: SideCostContext,
): void {
	const movingSides = relationSides(moving, targetAtSource);
	const otherSides = relationSides(other, targetAtSource);
	for (const [layer, movingEndpoints] of movingSides.side) {
		if (!movingEndpoints.some(({ id }) => id === context.targetId)) continue;
		const peers = otherSides.side.get(layer);
		if (!peers) continue;
		for (const [oppositeLayer, targetOpposites] of movingSides.opposite) {
			const peerOpposites = otherSides.opposite.get(oppositeLayer);
			if (!peerOpposites) continue;
			// FIXME: The compact graph avoids retained Cartesian memory, but this still does
			// Cartesian CPU work. Derive both counts with a linear scan of sorted ordinals.
			const [lower, higher] = oppositeOrdinalCounts(targetOpposites, peerOpposites);
			const weight = moving.pairWeight * other.pairWeight;
			addPeerCosts(peers, [lower, higher], weight, context);
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
	const context = { targetId, peerIndex, beforeByPeer, afterByPeer };
	const relations = indexRelations(metadata);
	for (const moving of relations) {
		for (const other of relations) {
			if (moving.relationId === other.relationId) continue;
			accumulateSideCosts(moving, other, true, context);
			accumulateSideCosts(moving, other, false, context);
		}
	}

	const scoreBySlot: number[] = [];
	let score = beforeByPeer.reduce((total, value) => total + value, 0);
	for (let slot = 0; slot <= peers.length; slot += 1) {
		scoreBySlot.push(score);
		if (slot < peers.length) {
			const peerDelta = (afterByPeer[slot] ?? 0) - (beforeByPeer[slot] ?? 0);
			score += peerDelta;
		}
	}
	return { currentSlot, beforeByPeer, afterByPeer, scoreBySlot };
}

function preferCandidateSlot(
	slot: number,
	bestSlot: number | undefined,
	currentSlot: number,
): boolean {
	if (bestSlot === undefined) return true;
	const slotDistance = Math.abs(slot - currentSlot);
	const bestDistance = Math.abs(bestSlot - currentSlot);
	if (slotDistance < bestDistance) return true;
	return slotDistance === bestDistance && slot < bestSlot;
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
		if (preferCandidateSlot(slot, bestSlot, scores.currentSlot)) bestSlot = slot;
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

function relationPairInversionScore(left: IndexedRelation, right: IndexedRelation): number {
	let score = 0;
	for (const [sourceLayer, leftSources] of left.sourceByLayer) {
		const rightSources = right.sourceByLayer.get(sourceLayer);
		if (!rightSources) continue;
		const [sourceLess, sourceGreater] = inversionCounts(leftSources, rightSources);
		for (const [targetLayer, leftTargets] of left.targetByLayer) {
			const rightTargets = right.targetByLayer.get(targetLayer);
			if (!rightTargets) continue;
			const [targetLess, targetGreater] = inversionCounts(leftTargets, rightTargets);
			const forwardInversions = sourceLess * targetGreater;
			const reverseInversions = sourceGreater * targetLess;
			score += forwardInversions + reverseInversions;
		}
	}
	const weightedLeftScore = score * left.pairWeight;
	return weightedLeftScore * right.pairWeight;
}

export function weightedInversionScore(metadata: CrossingOrderMetadata): number {
	let score = 0;
	const relations = indexRelations(metadata);
	for (const [index, left] of relations.entries()) {
		for (const right of relations.slice(index + 1)) {
			if (left.relationId !== right.relationId) score += relationPairInversionScore(left, right);
		}
	}
	return score;
}
