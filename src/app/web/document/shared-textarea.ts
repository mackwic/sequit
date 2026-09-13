import * as Y from 'yjs';

import { spliceSharedText } from '../../../lib/infrastructure/collaboration/shared-text';

/** Minimal DOM surface used by the binding, also usable by embedded textarea hosts. */
export interface SharedTextareaElement {
	value: string;
	selectionStart: number;
	selectionEnd: number;
	selectionDirection: HTMLTextAreaElement['selectionDirection'];
	setSelectionRange: HTMLTextAreaElement['setSelectionRange'];
	addEventListener: EventTarget['addEventListener'];
	removeEventListener: EventTarget['removeEventListener'];
}

export interface SharedTextareaOptions {
	readonly text: Y.Text;
	readonly edit: (next: string) => void;
	readonly merge: (update: Uint8Array) => void;
}

interface CompositionDraft {
	readonly document: Y.Doc;
	readonly text: Y.Text;
	readonly stateVector: Uint8Array;
}

/** Bind the actual textarea selection to stable CRDT positions across remote edits. */
export function sharedTextarea(
	element: SharedTextareaElement,
	options: SharedTextareaOptions,
): { destroy(): void } {
	const { text } = options;
	const document = text.doc;
	if (document === null) throw new Error('Text is not attached to a document');
	let localInput = false;
	let composition: CompositionDraft | undefined;
	let start: Y.RelativePosition | undefined;
	let end: Y.RelativePosition | undefined;
	let direction = element.selectionDirection;
	element.value = text.toJSON();
	const capture = (): void => {
		if (localInput || composition !== undefined) return;
		start = Y.createRelativePositionFromTypeIndex(text, element.selectionStart);
		end = Y.createRelativePositionFromTypeIndex(text, element.selectionEnd);
		direction = element.selectionDirection;
	};
	const render = (): void => {
		if (localInput || composition !== undefined) return;
		element.value = text.toJSON();
		if (start === undefined || end === undefined) return;
		const anchor = Y.createAbsolutePositionFromRelativePosition(start, document);
		const head = Y.createAbsolutePositionFromRelativePosition(end, document);
		if (anchor !== null && head !== null)
			element.setSelectionRange(anchor.index, head.index, direction);
	};
	const input = (): void => {
		if (composition !== undefined) return;
		localInput = true;
		try {
			options.edit(element.value);
		} finally {
			localInput = false;
		}
		capture();
	};
	const beginComposition = (): void => {
		const draft = new Y.Doc();
		Y.applyUpdate(draft, Y.encodeStateAsUpdate(document));
		const position = Y.createRelativePositionFromTypeIndex(text, 0);
		const target = Y.createAbsolutePositionFromRelativePosition(position, draft)?.type;
		if (!(target instanceof Y.Text)) {
			draft.destroy();
			return;
		}
		composition = { document: draft, text: target, stateVector: Y.encodeStateVector(draft) };
	};
	const endComposition = (): void => {
		const draft = composition;
		if (draft === undefined) return;
		draft.document.transact(() => {
			spliceSharedText(draft.text, element.value);
		});
		const caret = Y.createRelativePositionFromTypeIndex(draft.text, element.selectionEnd);
		composition = undefined;
		localInput = true;
		try {
			options.merge(Y.encodeStateAsUpdate(draft.document, draft.stateVector));
		} finally {
			localInput = false;
			draft.document.destroy();
		}
		start = caret;
		end = caret;
		render();
	};
	document.on('beforeTransaction', capture);
	text.observe(render);
	element.addEventListener('input', input);
	element.addEventListener('compositionstart', beginComposition);
	element.addEventListener('compositionend', endComposition);
	return {
		destroy(): void {
			document.off('beforeTransaction', capture);
			text.unobserve(render);
			element.removeEventListener('input', input);
			element.removeEventListener('compositionstart', beginComposition);
			element.removeEventListener('compositionend', endComposition);
			composition?.document.destroy();
		},
	};
}
