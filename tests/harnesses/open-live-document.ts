import * as Y from 'yjs';

import {
	importLogicDocument,
	readLogicDocument,
} from '../../src/lib/collaboration/yjs-live-document';
import type { LogicDocument } from '../../src/lib/document/logic-document';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
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
