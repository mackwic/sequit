import { parse, TomlError, type TomlTable } from 'smol-toml';

import { type DocumentResult, SequitDiagnosticCode } from '../document/logic-document';

export function parseTomlSyntax(source: string): DocumentResult<TomlTable> {
	try {
		return { ok: true, value: parse(source) };
	} catch (error) {
		if (error instanceof TomlError) {
			return {
				ok: false,
				diagnostics: [
					{
						code: SequitDiagnosticCode.TomlSyntax,
						message: error.message,
						path: [],
						line: error.line,
						column: error.column,
					},
				],
			};
		}

		throw error;
	}
}
