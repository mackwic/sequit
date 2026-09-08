import * as Y from 'yjs';

import type { LogicDocument } from '../../../src/lib/core/document/logic-document';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { parseSequitToml } from '../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

export function openLiveDocument(source: string): LogicDocument {
	const parsed = parseSequitToml(source);
	if (!parsed.ok) throw new Error('Reference TOML must parse');
	const ydoc = new Y.Doc();
	importLogicDocument(ydoc, parsed.value);
	const current = readLogicDocument(ydoc);
	if (!current.ok) throw new Error('Reference Y.Doc must be readable');
	return current.value;
}

export async function openReferenceLiveDocument(): Promise<LogicDocument> {
	return openLiveDocument(await aiDocumentaryEffortScenario());
}
