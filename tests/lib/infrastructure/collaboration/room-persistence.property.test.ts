import { Buffer } from 'node:buffer';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	CHUNK_BYTES,
	concatChunks,
	MAX_CHUNKS,
	splitChunks,
} from '../../../../src/lib/infrastructure/collaboration/room-persistence';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

describe('generated room persistence updates', () => {
	it('property: concat after split is the identity up to the ceiling', () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: CHUNK_BYTES * MAX_CHUNKS }), (update) => {
				expect(Buffer.compare(concatChunks(splitChunks(update)), update)).toBe(0);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
