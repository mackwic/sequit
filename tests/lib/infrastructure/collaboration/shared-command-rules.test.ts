import { expect, it } from 'vitest';

import { finalizeSharedCommand } from '../../../../src/lib/infrastructure/document/shared-command-rules';
import {
	SharedCommandKind,
	SharedElementKind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

it('propagates a relation validation failure from the existing topology rules', () => {
	const before = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
	const after = {
		...before,
		relations: [...before.relations, { id: 'cycle', from: 'A', to: 'B' }],
	};
	expect(() =>
		finalizeSharedCommand(before, after, {
			op: SharedCommandKind.Create,
			target: { kind: SharedElementKind.Relation, id: 'cycle' },
			properties: { from: 'A', to: 'B' },
		}),
	).toThrow();
});
