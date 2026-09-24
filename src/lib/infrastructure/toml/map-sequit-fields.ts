import { compareCanonicalStrings } from '../../core/canonical-string';
import {
	type OrderKey,
	type SequitDiagnostic,
	SequitDiagnosticCode,
} from '../../core/document/logic-document';
import { parseOrderKey } from '../../core/document/order-key';

export interface MappingContext {
	readonly diagnostics: SequitDiagnostic[];
}

export type UnknownTable = Record<string, unknown>;

function diagnosticCode(value: unknown): SequitDiagnostic['code'] {
	if (value === undefined) return SequitDiagnosticCode.MissingField;
	return SequitDiagnosticCode.InvalidType;
}

function isTable(value: unknown): value is UnknownTable {
	if (typeof value !== 'object') return false;
	return value !== null && !Array.isArray(value);
}

export function table(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): UnknownTable | undefined {
	if (isTable(value)) return value;
	context.diagnostics.push({
		code: diagnosticCode(value),
		message: `${path.join('.')} must be a table`,
		path,
	});
	return undefined;
}

export function string(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): string | undefined {
	if (typeof value === 'string') return value;
	context.diagnostics.push({
		code: diagnosticCode(value),
		message: `${path.join('.')} must be a string`,
		path,
	});
	return undefined;
}

export function optionalString(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): string | undefined {
	if (value === undefined) return undefined;
	return string(value, path, context);
}

export function requiredLayoutOrder(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
): OrderKey | undefined {
	const key = string(value, path, context);
	if (key === undefined) return undefined;
	const parsed = parseOrderKey(key);
	if (parsed !== undefined) return parsed;
	context.diagnostics.push({
		code: SequitDiagnosticCode.InvalidValue,
		message: `${path.join('.')} must be a valid fractional order key`,
		path,
	});
	return undefined;
}

export function entries(value: UnknownTable): readonly (readonly [string, unknown])[] {
	return Object.entries(value).sort(([left], [right]) => compareCanonicalStrings(left, right));
}

export function rejectUnknownFields(
	value: UnknownTable,
	allowed: readonly string[],
	path: readonly string[],
	options: { readonly context: MappingContext; readonly description: string },
): void {
	for (const key of Object.keys(value))
		if (!allowed.includes(key))
			options.context.diagnostics.push({
				code: SequitDiagnosticCode.InvalidValue,
				message: `Unsupported ${options.description} field: ${[...path, key].join('.')}`,
				path: [...path, key],
			});
}
