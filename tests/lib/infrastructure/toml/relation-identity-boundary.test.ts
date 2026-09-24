import { expect, it } from 'vitest';

import { SequitDiagnosticCode } from '../../../../src/lib/core/document/logic-document';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';
import { validLogicDocument } from '../../../support/builders/logic-document';

it('refuses a source relation array that a TOML keyed table would overwrite', () => {
	const source = validLogicDocument();
	const duplicate = {
		...source,
		relations: [...source.relations, { id: 'a-to-choice', from: 'source-b', to: 'choice' }],
	};
	expect(() => serializeSequitToml(duplicate)).toThrow('Duplicate relation IDs');
});

it('rejects a repeated relation table in TOML syntax', () => {
	const valid = serializeSequitToml(validLogicDocument());
	const repeated = `${valid}\n[relations.a-to-choice]\nfrom = "source-b"\nto = "choice"\n`;
	const result = parseSequitToml(repeated);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('Expected repeated TOML relation table to fail');
	expect(result.diagnostics[0]?.code).toBe(SequitDiagnosticCode.TomlSyntax);
});
