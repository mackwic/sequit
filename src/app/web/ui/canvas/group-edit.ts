import type { LogicDocument } from '../../../../lib/core/document/logic-document';
import { EntityKind, type EntityRef } from './canvas-entity';
import { CANVAS_SHORTCUTS, type CanvasShortcut, CanvasShortcutId } from './canvas-shortcuts';

/** Grouping needs at least two nodes, nothing else selected, all in the same container. */
export function groupableNodeIds(
	document: LogicDocument,
	selection: Iterable<EntityRef>,
): readonly string[] | undefined {
	const members: string[] = [];
	for (const { kind, id } of selection) {
		if (kind !== EntityKind.Node) return undefined;
		members.push(id);
	}
	if (members.length < 2) return undefined;
	const containers = new Set<string | undefined>();
	for (const id of members) {
		const node = document.nodes.find((candidate) => candidate.id === id);
		if (node === undefined) return undefined;
		containers.add(node.groupId);
	}
	if (containers.size !== 1) return undefined;
	return members;
}

/** `[` folds, `]` unfolds, as in an editor: the shortcut that applies now. */
export function foldToggleShortcut(closed: boolean): CanvasShortcut {
	if (closed) return CANVAS_SHORTCUTS[CanvasShortcutId.Unfold];
	return CANVAS_SHORTCUTS[CanvasShortcutId.Fold];
}

/** The fold action names its effect, never the current state. */
export function foldActionLabel(closed: boolean): string {
	return foldToggleShortcut(closed).label;
}
