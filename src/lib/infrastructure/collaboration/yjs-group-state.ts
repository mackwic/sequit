import type * as Y from 'yjs';

import { groupStateFields } from '../../core/document/logic-document';
import { type ReadContext, YjsLiveDocumentDiagnosticCode } from './yjs-document-result';

export function readGroupState(
	entity: Y.Map<unknown>,
	id: string,
	context: ReadContext,
): ReturnType<typeof groupStateFields> {
	try {
		return groupStateFields(entity.get('state'));
	} catch {
		context.diagnostics.push({
			code: YjsLiveDocumentDiagnosticCode.Invalid,
			message: 'Group state must be expanded or closed',
			path: ['groups', id, 'state'],
		});
		return {};
	}
}
