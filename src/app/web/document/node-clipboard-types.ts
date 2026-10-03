import type { GroupState, JunctionOperator } from '../../../lib/core/document/logic-document';

export const NODE_CLIPBOARD_PREFIX = 'sequit:nodes:2\n';

export interface ClipboardSelection {
	readonly kind: string;
	readonly id: string;
}

export interface CopiedNode {
	readonly id: string;
	readonly natureId: string;
	readonly markdown: string;
	readonly description?: string;
	readonly color?: string;
	readonly icon?: string;
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
}

export interface CopiedGroup {
	readonly id: string;
	readonly label: string;
	readonly state?: GroupState;
	readonly color?: string;
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
}

export interface CopiedJunction {
	readonly id: string;
	readonly operator: JunctionOperator;
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
}

export interface CopiedRelation {
	readonly id: string;
	readonly from: string;
	readonly to: string;
}

export interface NodeClipboard {
	readonly documentId: string;
	readonly nodes: readonly CopiedNode[];
	readonly groups: readonly CopiedGroup[];
	readonly junctions: readonly CopiedJunction[];
	readonly relations: readonly CopiedRelation[];
}

/** An explicit destination replaces every copied node's original container. */
export interface NodePasteDestination {
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
}
