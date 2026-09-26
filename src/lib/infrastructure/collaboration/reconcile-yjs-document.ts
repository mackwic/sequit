import * as Y from 'yjs';

import type { DocumentCommandDiagnostic } from '../document/document-command-contracts';
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

function samePath(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((part, index) => part === right[index]);
}

function physicalInvalidPath(path: readonly string[]): readonly string[] {
	const region = path[0] === 'regionPresentation';
	const grid = path[1] === 'regions' && path[3] === 'grid';
	if (region && grid) return ['regionGrids', ...path.slice(2, 3), ...path.slice(4)];
	if (path[0] === 'nodes' && path[2] === 'nature')
		return ['nodes', ...path.slice(1, 2), 'natureId', ...path.slice(3)];
	return path;
}

function malformedEntityReplacement(current: unknown, checkpoint: unknown): boolean {
	if (current === undefined) return false;
	if (checkpoint === undefined) return true;
	if (!(checkpoint instanceof Y.Map)) return false;
	return !(current instanceof Y.Map);
}

function isMalformedValue(
	current: unknown,
	checkpoint: unknown,
	path: readonly string[],
	invalidPaths: readonly (readonly string[])[],
): boolean {
	const newRelation = path[0] === 'relations' && checkpoint === undefined;
	for (const invalid of invalidPaths) {
		const physical = physicalInvalidPath(invalid);
		if (samePath(physical, path)) {
			if (path.length > 2) return true;
			return malformedEntityReplacement(current, checkpoint);
		}
		if (newRelation && current instanceof Y.Map && samePath(physical.slice(0, path.length), path))
			return true;
	}
	return false;
}

interface RecoveryInspection {
	readonly invalidPaths: readonly (readonly string[])[];
	readonly conflicts: Map<string, readonly string[]>;
}

function changedFields(
	current: unknown,
	checkpoint: unknown,
	path: readonly string[],
	inspection: RecoveryInspection,
): void {
	if (current instanceof Y.Map && checkpoint instanceof Y.Map) {
		for (const key of new Set([...current.keys(), ...checkpoint.keys()]))
			changedFields(current.get(key), checkpoint.get(key), [...path, key], inspection);
		return;
	}
	const arrays = Array.isArray(current) && Array.isArray(checkpoint);
	if (arrays && current.length === checkpoint.length) {
		for (let index = 0; index < current.length; index += 1)
			changedFields(current[index], checkpoint[index], [...path, String(index)], inspection);
		return;
	}
	if (current instanceof Y.Text && checkpoint instanceof Y.Text) {
		if (current.toJSON() === checkpoint.toJSON()) return;
	} else if (sameScalarOrArray(current, checkpoint)) return;
	// Only fields diagnosed invalid may be restored automatically. Every other
	// divergence might contain a valid edit, including on the same entity.
	if (isMalformedValue(current, checkpoint, path, inspection.invalidPaths)) return;
	const entity = path.slice(0, Math.min(path.length, 2));
	inspection.conflicts.set(entity.join('/'), entity);
}

export function recoveryConflictPaths(
	physical: Y.Doc,
	checkpoint: Y.Doc,
	invalidPaths: readonly (readonly string[])[],
): readonly (readonly string[])[] {
	const inspection: RecoveryInspection = {
		invalidPaths,
		conflicts: new Map<string, readonly string[]>(),
	};
	for (const collection of COLLECTIONS) {
		const name = collection.slice('sequit.'.length);
		changedFields(physical.getMap(collection), checkpoint.getMap(collection), [name], inspection);
	}
	return [...inspection.conflicts.values()];
}

export function recoveryConflictDiagnostic(
	paths: readonly (readonly string[])[],
): DocumentCommandDiagnostic {
	const names = paths.map((path) => path.join('/')).join(', ');
	let message =
		'Further updates arrived while the document was invalid; automatic recovery is unsafe';
	if (names !== '') message = `Automatic recovery would discard edits to ${names}`;
	return { code: 'recovery-conflict', message, path: paths[0] ?? [] };
}
