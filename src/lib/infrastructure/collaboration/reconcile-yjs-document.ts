import * as Y from 'yjs';

import { spliceSharedText } from './shared-text';
import { YjsCollection } from './yjs-document-schema';

const COLLECTIONS = [
	YjsCollection.Meta,
	YjsCollection.Natures,
	YjsCollection.Groups,
	YjsCollection.Nodes,
	YjsCollection.Junctions,
	YjsCollection.Relations,
	YjsCollection.Lanes,
	YjsCollection.Regions,
	YjsCollection.RegionLanes,
	YjsCollection.RegionGrids,
	YjsCollection.GridCells,
] as const;

function sameScalarOrArray(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (!Array.isArray(left)) return false;
	if (!Array.isArray(right)) return false;
	if (left.length !== right.length) return false;
	return left.every((value, index) => Object.is(value, right[index]));
}

function cloneValue(value: unknown): unknown {
	if (value instanceof Y.Text) {
		const text = new Y.Text();
		text.insert(0, value.toJSON());
		return text;
	}
	if (value instanceof Y.Map) {
		const map = new Y.Map<unknown>();
		for (const [key, child] of value.entries()) map.set(key, cloneValue(child));
		return map;
	}
	if (Array.isArray(value)) return value.map(cloneValue);
	return value;
}

function reconcileMap(target: Y.Map<unknown>, source: Y.Map<unknown>): void {
	for (const key of target.keys()) if (!source.has(key)) target.delete(key);
	for (const [key, value] of source.entries()) {
		const current = target.get(key);
		if (value instanceof Y.Map && current instanceof Y.Map) reconcileMap(current, value);
		else if (value instanceof Y.Text && current instanceof Y.Text) {
			const nextText = value.toJSON();
			if (current.toJSON() !== nextText) spliceSharedText(current, nextText);
		} else if (!sameScalarOrArray(current, value)) target.set(key, cloneValue(value));
	}
}

export function reconcileYjsDocument(target: Y.Doc, checkpoint: Y.Doc): void {
	for (const collection of COLLECTIONS)
		reconcileMap(target.getMap(collection), checkpoint.getMap(collection));
}
