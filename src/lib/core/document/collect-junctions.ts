import { defined, type LogicDocument } from './logic-document';

enum ConnectionSide {
	Incoming = 'incoming',
	Outgoing = 'outgoing',
}

/** Remove unanchored junctions to a fixed point, without touching surviving identities or order. */
export function collectJunctions(document: LogicDocument): LogicDocument {
	const incoming = new Map<string, string[]>();
	const outgoing = new Map<string, string[]>();
	for (const { id } of document.junctions) {
		incoming.set(id, []);
		outgoing.set(id, []);
	}
	for (const relation of document.relations) {
		incoming.get(relation.to)?.push(relation.from);
		outgoing.get(relation.from)?.push(relation.to);
	}
	const degrees = new Map(
		document.junctions.map(({ id }) => [
			id,
			{
				incoming: defined(incoming.get(id)).length,
				outgoing: defined(outgoing.get(id)).length,
			},
		]),
	);
	const pending = document.junctions
		.filter(({ id }) => {
			const degree = defined(degrees.get(id));
			return degree.incoming === 0 || degree.outgoing === 0;
		})
		.map(({ id }) => id);
	const removed = new Set(pending);
	const decrement = (id: string, side: ConnectionSide): void => {
		const degree = degrees.get(id);
		if (degree === undefined || removed.has(id)) return;
		degree[side] -= 1;
		if (degree[side] !== 0) return;
		removed.add(id);
		pending.push(id);
	};
	for (const id of pending) {
		for (const source of defined(incoming.get(id))) decrement(source, ConnectionSide.Outgoing);
		for (const target of defined(outgoing.get(id))) decrement(target, ConnectionSide.Incoming);
	}
	if (removed.size === 0) return document;
	return {
		...document,
		junctions: document.junctions.filter(({ id }) => !removed.has(id)),
		relations: document.relations.filter(({ from, to }) => !removed.has(from) && !removed.has(to)),
	};
}
