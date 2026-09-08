import { styleDocumentNature, styleDocumentNode } from '../../../lib/document/content-style';
import type {
	ContentStyle,
	LayoutDirection,
	LogicDocument,
	LogicNature,
	LogicRelation,
	NewLogicNode,
} from '../../../lib/document/logic-document';
import {
	changeWorkshopMembership,
	dissolveWorkshopGroup,
	groupWorkshopNodes,
} from './workshop-group-operations';
import {
	arrangeWorkshopDocument,
	emptyWorkshopDocument,
	renameWorkshopDocument,
	renameWorkshopGroup,
} from './workshop-metadata-operations';
import {
	assignWorkshopNature,
	removeWorkshopNature,
	saveWorkshopNature,
} from './workshop-nature-operations';
import {
	addWorkshopNode,
	duplicateWorkshopNodes,
	placeWorkshopNodeFirst,
	removeWorkshopNodes,
} from './workshop-node-operations';
import {
	createWorkshopConvergence,
	removeWorkshopRelation,
	retargetWorkshopRelation,
	type WorkshopConvergence,
} from './workshop-relation-operations';

/** Explicit local experiments. Each operation reads the current document and commits once.
 * This is not a collaborative gateway; promote accepted operations into product commands there. */
export class WorkshopCommands {
	constructor(
		private readonly edit: (change: (current: LogicDocument) => LogicDocument) => void,
		readonly addRelation: (relation: LogicRelation) => Promise<LogicDocument>,
	) {}
	addNode(node: NewLogicNode, link?: { readonly id: string; readonly from: string }): void {
		this.edit((current) => addWorkshopNode(current, node, link));
	}
	duplicateNodes(copies: readonly { readonly sourceId: string; readonly id: string }[]): void {
		this.edit((current) => duplicateWorkshopNodes(current, copies));
	}
	removeNodes(ids: ReadonlySet<string>): void {
		this.edit((current) => removeWorkshopNodes(current, ids));
	}
	placeNodeFirst(id: string): void {
		this.edit((current) => placeWorkshopNodeFirst(current, id));
	}
	groupNodes(
		group: { readonly id: string; readonly label: string },
		ids: ReadonlySet<string>,
	): void {
		this.edit((current) => groupWorkshopNodes(current, group, ids));
	}
	changeMembership(groupId: string, ids: ReadonlySet<string>, add: boolean): void {
		this.edit((current) => changeWorkshopMembership(current, groupId, ids, add));
	}
	dissolveGroup(id: string): void {
		this.edit((current) => dissolveWorkshopGroup(current, id));
	}
	renameGroup(id: string, label: string): void {
		this.edit((current) => renameWorkshopGroup(current, id, label));
	}
	saveNature(nature: LogicNature): void {
		this.edit((current) => saveWorkshopNature(current, nature));
	}
	assignNature(natureId: string, ids: ReadonlySet<string>): void {
		this.edit((current) => assignWorkshopNature(current, natureId, ids));
	}
	removeNature(id: string, replacementId: string): void {
		this.edit((current) => removeWorkshopNature(current, id, replacementId));
	}
	styleNode(id: string, style: ContentStyle): void {
		this.edit((current) => styleDocumentNode(current, id, style));
	}
	styleNature(id: string, style: ContentStyle): void {
		this.edit((current) => styleDocumentNature(current, id, style));
	}
	retargetRelation(relation: LogicRelation): void {
		this.edit((current) => retargetWorkshopRelation(current, relation));
	}
	removeRelation(id: string): void {
		this.edit((current) => removeWorkshopRelation(current, id));
	}
	createConvergence(convergence: WorkshopConvergence): void {
		this.edit((current) => createWorkshopConvergence(current, convergence));
	}
	renameDocument(title: string): void {
		this.edit((current) => renameWorkshopDocument(current, title));
	}
	newDocument(id: string): void {
		this.edit((current) => emptyWorkshopDocument(current, id));
	}
	arrange(direction: LayoutDirection): void {
		this.edit((current) => arrangeWorkshopDocument(current, direction));
	}
}
