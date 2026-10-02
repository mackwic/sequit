import type { Bounds } from '../../../../lib/core/layout/layout-types';
import {
	DocumentCommandDiagnosticCode,
	type DocumentCommandOutcome,
	nodeEditingUnavailableOutcome,
} from '../../../../lib/infrastructure/document/document-command-contracts';
import type { NodeFields } from '../../../../lib/infrastructure/document/node-fields';
import type { EntityKey } from '../canvas/canvas-entity';

/** How the canvas reads and writes the node behind the box dialog. */
export interface CanvasDocumentCommandPort {
	/** The current fields of a node, or `undefined` once it is gone. */
	readonly readNode: (nodeId: string) => NodeFields | undefined;
	/** Applies the changed fields; text goes through the node's text, properties through a command. */
	readonly saveNode: (
		nodeId: string,
		base: NodeFields,
		draft: NodeFields,
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

interface IdleCanvasActivity {
	readonly kind: CanvasActivityKind.Idle;
}

export interface EditingCanvasActivity {
	readonly kind: CanvasActivityKind.Editing;
	readonly target: EntityKey;
	readonly nodeId: string;
	readonly base: NodeFields;
	readonly draft: NodeFields;
	readonly frozenBounds: Bounds;
	readonly availability: CanvasEditAvailability;
	readonly diagnostic: string | undefined;
	readonly saving: boolean;
	readonly layoutRevision: number;
	readonly saveId: number | undefined;
}

export type CanvasActivity = IdleCanvasActivity | EditingCanvasActivity;

export const idleCanvasActivity = (): IdleCanvasActivity => ({ kind: CanvasActivityKind.Idle });

export const unavailableCanvasCommands: CanvasDocumentCommandPort = {
	readNode: () => undefined,
	saveNode: (nodeId) => {
		return Promise.resolve(
			nodeEditingUnavailableOutcome(DocumentCommandDiagnosticCode.NodeMarkdownUnavailable, nodeId),
		);
	},
};
