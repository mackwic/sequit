import { defined } from '../document/logic-document';

enum VisitState {
	Visiting = 'visiting',
	Visited = 'visited',
}

interface VisitFrame {
	readonly id: string;
	nextTarget: number;
}

export function findCycle(
	endpointIds: readonly string[],
	outgoingByEndpointId: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
	const state = new Map<string, VisitState>();
	const path: string[] = [];
	const pathIndex = new Map<string, number>();
	for (const id of endpointIds) {
		if (state.has(id)) continue;
		const frames: VisitFrame[] = [{ id, nextTarget: 0 }];
		state.set(id, VisitState.Visiting);
		pathIndex.set(id, path.length);
		path.push(id);
		while (frames.length > 0) {
			const frame = defined(frames.at(-1));
			const targets = defined(outgoingByEndpointId.get(frame.id));
			if (frame.nextTarget >= targets.length) {
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
			frames.push({ id: target, nextTarget: 0 });
		}
	}
	return undefined;
}
