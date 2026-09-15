import { EntityKind, type EntityRef } from './canvas-entity';

interface ClientPoint {
	readonly x: number;
	readonly y: number;
}

interface EntityCandidate {
	readonly ref: EntityRef;
	readonly bounds: {
		readonly top: number;
		readonly right: number;
		readonly bottom: number;
		readonly left: number;
	};
}

interface SelectionEnvelope {
	readonly from: ClientPoint;
	readonly to: ClientPoint;
	readonly additive: boolean;
}

export function selectionInsideEnvelope(
	initial: readonly EntityRef[],
	candidates: readonly EntityCandidate[],
	envelope: SelectionEnvelope,
): readonly EntityRef[] {
	const { from, to } = envelope;
	const left = Math.min(from.x, to.x);
	const right = Math.max(from.x, to.x);
	const top = Math.min(from.y, to.y);
	const bottom = Math.max(from.y, to.y);
	const selected: EntityRef[] = [];
	if (envelope.additive) selected.push(...initial);
	for (const { ref, bounds } of candidates) {
		const selectable = ref.kind === EntityKind.Node || ref.kind === EntityKind.Junction;
		if (!selectable) continue;
		const intersectsHorizontally = bounds.right >= left && bounds.left <= right;
		const intersectsVertically = bounds.bottom >= top && bounds.top <= bottom;
		const intersects = intersectsHorizontally && intersectsVertically;
		if (!intersects) continue;
		if (selected.some((candidate) => candidate.kind === ref.kind && candidate.id === ref.id))
			continue;
		selected.push(ref);
	}
	return selected;
}
