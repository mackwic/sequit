import { describe, expect, it, vi } from 'vitest';

import { createDocumentSession } from '../../src/lib/document/document-session';
import { validLogicDocument } from '../builders/logic-document';

describe('DocumentSession lifecycle', () => {
	it('notifies active subscribers and becomes inert after destruction', () => {
		const session = createDocumentSession(validLogicDocument());
		const listener = vi.fn();
		const unsubscribe = session.subscribe(listener);

		expect(session.replaceNodeMarkdown('source-a', 'First update\n')).toBe(true);
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
		expect(session.replaceNodeMarkdown('source-a', 'Second update\n')).toBe(true);
		expect(listener).toHaveBeenCalledTimes(1);

		session.destroy();
		expect(session.replaceNodeMarkdown('source-a', 'Ignored update\n')).toBe(false);
		const unsubscribeAfterDestroy = session.subscribe(listener);
		unsubscribeAfterDestroy();
		session.destroy();
	});
});
