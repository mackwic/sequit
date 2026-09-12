import { defined } from '../document/logic-document';

enum VisitState {
	Visiting = 'visiting',
	Visited = 'visited',
}

interface VisitFrame {
	readonly id: string;
	readonly targets: readonly string[];
	nextTarget: number;
}

function visitFrame(
	id: string,
	adjacency: ReadonlyMap<string, readonly string[]>,
	completed: ReadonlySet<readonly string[]>,
): VisitFrame {
	const targets = defined(adjacency.get(id));
	let nextTarget = 0;
	if (completed.has(targets)) nextTarget = targets.length;
	return { id, targets, nextTarget };
}

export function findCycle(
	endpointIds: readonly string[],
	outgoingByEndpointId: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
	const state = new Map<string, VisitState>();
	const completedNeighbors = new Set<readonly string[]>();
	const path: string[] = [];
	const pathIndex = new Map<string, number>();
	for (const id of endpointIds) {
		if (state.has(id)) continue;
		const frames: VisitFrame[] = [visitFrame(id, outgoingByEndpointId, completedNeighbors)];
		state.set(id, VisitState.Visiting);
		pathIndex.set(id, path.length);
		path.push(id);
		while (frames.length > 0) {
			const frame = defined(frames.at(-1));
			const targets = frame.targets;
			if (frame.nextTarget >= targets.length) {
				completedNeighbors.add(targets);
				frames.pop();
				path.pop();
				pathIndex.delete(frame.id);
				state.set(frame.id, VisitState.Visited);
				continue;
			}
			const target = defined(targets[frame.nextTarget]);
			frame.nextTarget += 1;
			if (state.get(target) === VisitState.Visiting) {
				return [...path.slice(defined(pathIndex.get(target))), target];
			}
			if (state.get(target) === VisitState.Visited) continue;
			state.set(target, VisitState.Visiting);
			pathIndex.set(target, path.length);
			path.push(target);
			frames.push(visitFrame(target, outgoingByEndpointId, completedNeighbors));
		}
	}
	return undefined;
}
