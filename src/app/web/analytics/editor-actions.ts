import {
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
} from '../../../lib/infrastructure/document/document-command-contracts';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
} from '../../../lib/infrastructure/document/shared-document-command';
import { captureProductEvent, ProductEvent, type ProductEventProperties } from './analytics';

/** The editor action an accepted batch stands for, as PostHog counts it. */
export interface EditorAction {
	readonly event: ProductEvent;
	readonly properties?: ProductEventProperties;
}

interface CommandDispatcher {
	dispatch(commands: readonly SharedDocumentCommand[]): Promise<DocumentCommandOutcome>;
}

function created(
	commands: readonly SharedDocumentCommand[],
	kind: SharedElementKind,
): readonly SharedDocumentCommand[] {
	return commands.filter(
		(command) => command.op === SharedCommandKind.Create && command.target.kind === kind,
	);
}

function removedCount(commands: readonly SharedDocumentCommand[]): number {
	let count = 0;
	for (const command of commands) {
		if (command.op === SharedCommandKind.DeleteRelations) count += command.ids.length;
		if (command.op === SharedCommandKind.Delete && command.target.kind !== SharedElementKind.Nature)
			count += 1;
	}
	return count;
}

/** One box is typed, possibly from another box it is linked to; several are pasted. */
function nodeCreation(nodes: number, commands: readonly SharedDocumentCommand[]): EditorAction {
	if (nodes > 1) return { event: ProductEvent.NodesPasted, properties: { count: nodes } };
	const linked = created(commands, SharedElementKind.Relation).length > 0;
	return { event: ProductEvent.NodeCreated, properties: { linked } };
}

function natureCreation(natures: number): EditorAction {
	if (natures > 1) return { event: ProductEvent.NaturesImported, properties: { count: natures } };
	return { event: ProductEvent.NatureCreated };
}

/** Batches that create or remove elements, where the main creation names the action. */
function structuralAction(commands: readonly SharedDocumentCommand[]): EditorAction | undefined {
	if (created(commands, SharedElementKind.Junction).length > 0)
		return { event: ProductEvent.JunctionInserted };
	const nodes = created(commands, SharedElementKind.Node).length;
	if (nodes > 0) return nodeCreation(nodes, commands);
	const removed = removedCount(commands);
	if (removed > 0) return { event: ProductEvent.SelectionDeleted, properties: { count: removed } };
	const natures = created(commands, SharedElementKind.Nature).length;
	if (natures > 0) return natureCreation(natures);
	if (created(commands, SharedElementKind.Relation).length > 0)
		return { event: ProductEvent.NodesLinked };
	return undefined;
}

function updateAction(
	command: Extract<SharedDocumentCommand, { op: SharedCommandKind.Update }>,
): EditorAction | undefined {
	const fields = Object.keys(command.set);
	switch (command.target.kind) {
		case SharedElementKind.Nature:
			return { event: ProductEvent.NatureEdited };
		case SharedElementKind.Group:
			if (fields.length === 1 && fields[0] === 'state') return { event: ProductEvent.GroupToggled };
			return { event: ProductEvent.GroupEdited };
		case SharedElementKind.Junction:
			return { event: ProductEvent.JunctionEdited };
		case SharedElementKind.Node:
			if (fields.includes('natureId')) return { event: ProductEvent.NodeNatureChanged };
			return undefined;
		case SharedElementKind.Relation:
			return undefined;
		default: {
			const unhandled: never = command.target;
			throw new Error(`Unhandled update target: ${String(unhandled)}`);
		}
	}
}

function singleAction(command: SharedDocumentCommand): EditorAction | undefined {
	switch (command.op) {
		case SharedCommandKind.Delete:
			if (command.target.kind === SharedElementKind.Nature)
				return { event: ProductEvent.NatureDeleted };
			return undefined;
		case SharedCommandKind.Group:
			return { event: ProductEvent.GroupCreated, properties: { count: command.members.length } };
		case SharedCommandKind.Ungroup:
			return { event: ProductEvent.GroupDissolved };
		case SharedCommandKind.Move:
			return { event: ProductEvent.ElementsMoved, properties: { count: command.ids.length } };
		case SharedCommandKind.UpdateLayout:
			return { event: ProductEvent.LayoutChanged };
		case SharedCommandKind.UpdateLanes:
			return { event: ProductEvent.LanesEdited };
		case SharedCommandKind.Update:
			return updateAction(command);
		case SharedCommandKind.Create:
		case SharedCommandKind.DeleteRelations:
			return undefined;
		default: {
			const unhandled: never = command;
			throw new Error(`Unhandled shared command: ${String(unhandled)}`);
		}
	}
}

/**
 * Names the editor action of one batch from its commands alone, so both workspaces count the same
 * intents: creations and removals first, since they carry relation and group bookkeeping.
 */
export function editorAction(commands: readonly SharedDocumentCommand[]): EditorAction | undefined {
	const structural = structuralAction(commands);
	if (structural !== undefined) return structural;
	const [first] = commands;
	if (first === undefined) return undefined;
	return singleAction(first);
}

/**
 * Proposes an editor batch and counts it once accepted. Undo and redo do not come through here:
 * they replay history, not a new action. A session that refuses commands still throws at once.
 */
export function dispatchEditorAction(
	session: CommandDispatcher,
	commands: readonly SharedDocumentCommand[],
): Promise<DocumentCommandOutcome> {
	return session.dispatch(commands).then((outcome) => {
		const action = editorAction(commands);
		if (outcome.kind === DocumentCommandOutcomeKind.Accepted && action !== undefined)
			captureProductEvent(action.event, action.properties);
		return outcome;
	});
}
