import type { VisibleRelationProjection } from '../../../lib/core/document/collapsed-document';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
} from '../../../lib/infrastructure/document/shared-document-command';

/** A visible aggregate is a view; only its original relation IDs are command targets. */
export function deleteVisibleRelation(
	projection: VisibleRelationProjection,
): readonly SharedDocumentCommand[] {
	return [
		{
			op: SharedCommandKind.DeleteRelations,
			ids: projection.sourceRelationIds,
		},
	];
}

export function hiddenRelationFields(projection: VisibleRelationProjection): readonly string[] {
	const fields: string[] = [];
	if (!projection.canChangeFrom) fields.push('from');
	if (!projection.canChangeTo) fields.push('to');
	return fields;
}
