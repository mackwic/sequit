import type { Bounds } from '../../../../lib/core/layout/layout-types';
import {
	DocumentCommandDiagnosticCode,
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
} from '../../../../lib/infrastructure/document/document-command-contracts';
import {
	type CanvasEntityIndex,
	type EntityKey,
	entityKey,
	EntityKind,
	type EntityRef,
} from '../canvas/canvas-entity';

export interface CanvasDocumentCommandPort {
	readonly replaceNodeMarkdown: (
		nodeId: string,
		markdown: string,
	) => Promise<DocumentCommandOutcome>;
}

export enum CanvasActivityKind {
	Idle = 'idle',
	Editing = 'editing',
}

export enum CanvasEditAvailability {
	Available = 'available',
	Deleted = 'deleted',
}

export enum CanvasEditableField {
	Markdown = 'markdown',
}

interface IdleCanvasActivity {
	readonly kind: CanvasActivityKind.Idle;
}

export interface EditingCanvasActivity {
	readonly kind: CanvasActivityKind.Editing;
	readonly target: EntityKey;
	readonly nodeId: string;
	readonly field: CanvasEditableField;
	readonly baseValue: string;
	readonly draft: string;
	readonly frozenBounds: Bounds;
	readonly availability: CanvasEditAvailability;
	readonly diagnostic: string | undefined;
	readonly saving: boolean;
	readonly layoutRevision: number;
	readonly saveId: number | undefined;
}

export type CanvasActivity = IdleCanvasActivity | EditingCanvasActivity;

export interface PendingNodeEdit {
	readonly target: EntityKey;
	readonly nodeId: string;
	readonly markdown: string;
}

export interface NodeEditDraft {
	readonly id: string;
	readonly markdown: string;
}

export function queuePendingNodeEdit(
	selection: Map<EntityKey, EntityRef>,
	node: NodeEditDraft,
): PendingNodeEdit {
	const target = entityKey(EntityKind.Node, node.id);
	selection.clear();
	selection.set(target, { kind: EntityKind.Node, id: node.id });
	return { target, nodeId: node.id, markdown: node.markdown };
}

export class PendingNodeCreation {
	#cancel: (() => void) | undefined;

	queue(cancel?: () => void): true {
		this.#cancel = cancel;
		return true;
	}

	commit(): void {
		this.#cancel = undefined;
	}

	finish(commit: boolean): boolean {
		if (commit) this.commit();
		return this.cancel();
	}

	cancel(): boolean {
		const cancel = this.#cancel;
		this.#cancel = undefined;
		cancel?.();
		return cancel !== undefined;
	}
}

export const idleCanvasActivity = (): IdleCanvasActivity => ({ kind: CanvasActivityKind.Idle });

export function pendingNodeEditActivity(
	pending: PendingNodeEdit | undefined,
	index: CanvasEntityIndex,
	layoutRevision: number,
): EditingCanvasActivity | undefined {
	if (pending === undefined) return undefined;
	const bounds = index.get(pending.target)?.bounds;
	if (bounds === undefined) return undefined;
	return {
		kind: CanvasActivityKind.Editing,
		target: pending.target,
		nodeId: pending.nodeId,
		field: CanvasEditableField.Markdown,
		baseValue: pending.markdown,
		draft: pending.markdown,
		frozenBounds: { ...bounds },
		availability: CanvasEditAvailability.Available,
		diagnostic: undefined,
		saving: false,
		layoutRevision,
		saveId: undefined,
	};
}

export const unavailableCanvasCommands: CanvasDocumentCommandPort = {
	replaceNodeMarkdown: (nodeId) => {
		return Promise.resolve({
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [
				{
					code: DocumentCommandDiagnosticCode.NodeMarkdownUnavailable,
					message: `Node Markdown editing is unavailable: ${nodeId}`,
					path: ['nodes', nodeId, 'markdown'],
				},
			],
		});
	},
};

interface AcceptedCommandOutcome {
	readonly kind: DocumentCommandOutcomeKind.Accepted;
}

export function canvasCommandDiagnostic(
	outcome: Exclude<DocumentCommandOutcome, AcceptedCommandOutcome>,
): string {
	if (outcome.kind === DocumentCommandOutcomeKind.Failed) {
		if (outcome.error instanceof Error) return outcome.error.message;
		return String(outcome.error);
	}
	return outcome.diagnostics.map(({ message }) => message).join('; ');
}
