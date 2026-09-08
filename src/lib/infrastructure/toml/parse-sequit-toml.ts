import type { DocumentResult, LogicDocument } from '../../core/document/logic-document';
import { validateLogicDocument } from '../../core/document/validate-logic-document';
import { mapSequitDocument } from './map-sequit-document';
import { parseTomlSyntax } from './toml-syntax';

export function parseSequitToml(source: string): DocumentResult<LogicDocument> {
	const syntax = parseTomlSyntax(source);
	if (!syntax.ok) return syntax;

	const mapped = mapSequitDocument(syntax.value);
	if (!mapped.ok) return mapped;

	return validateLogicDocument(mapped.value);
}
