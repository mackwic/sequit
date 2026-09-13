import * as Y from 'yjs';

import type { OrderKey } from '../../core/document/logic-document';
import { parseOrderKey } from '../../core/document/order-key';
import { type ReadContext, YjsLiveDocumentDiagnosticCode } from './yjs-document-result';

export function readString(
	value: unknown,
	path: readonly string[],
	context: ReadContext,
): string | undefined {
	if (typeof value === 'string') return value;
	context.diagnostics.push({
		code: YjsLiveDocumentDiagnosticCode.Invalid,
		message: `${path.join('.')} must be a string`,
		path,
	});
	return undefined;
}

export function readText(
	value: unknown,
	path: readonly string[],
	context: ReadContext,
): string | undefined {
	if (value instanceof Y.Text) return value.toJSON();
	return readString(value, path, context);
}

export function readOptionalString(
	value: unknown,
	path: readonly string[],
	context: ReadContext,
): string | undefined {
	if (value === undefined) return undefined;
	return readString(value, path, context);
}

export function readRequiredLayoutOrder(
	value: unknown,
	path: readonly string[],
	context: ReadContext,
): OrderKey | undefined {
	const key = readString(value, path, context);
	if (key === undefined) return undefined;
	const parsed = parseOrderKey(key);
	if (parsed !== undefined) return parsed;
	context.diagnostics.push({
		code: YjsLiveDocumentDiagnosticCode.Invalid,
		message: `${path.join('.')} must be a valid fractional order key`,
		path,
	});
	return undefined;
}
