import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	type CollabMessage,
	CollabMessageKind,
	decodeCollabMessage,
	encodeCollabMessage,
	MAX_PROPOSAL_ID_BYTES,
	ProposalIntent,
} from '../../../../src/lib/infrastructure/collaboration/protocol';

const bytesArbitrary = fc.uint8Array({ maxLength: 64 });
const commitArbitrary = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
const diagnosticArbitrary = fc.record({
	code: fc.string(),
	message: fc.string(),
	path: fc.array(fc.string(), { maxLength: 8 }),
});
const proposalIdArbitrary = fc
	.string({ minLength: 1, maxLength: MAX_PROPOSAL_ID_BYTES })
	.filter((value) => new TextEncoder().encode(value).byteLength <= MAX_PROPOSAL_ID_BYTES);

const messageArbitrary: fc.Arbitrary<CollabMessage> = fc.oneof(
	fc.record({
		type: fc.constant(CollabMessageKind.SyncRequest),
		lastCommit: commitArbitrary,
		stateVector: bytesArbitrary,
	}),
	fc.record({
		type: fc.constant(CollabMessageKind.SyncResponse),
		commit: commitArbitrary,
		update: bytesArbitrary,
		stateVector: bytesArbitrary,
	}),
	fc.record({
		type: fc.constant(CollabMessageKind.Proposal),
		proposalId: proposalIdArbitrary,
		intent: fc.constantFrom(ProposalIntent.Initialize, ProposalIntent.Change),
		update: bytesArbitrary,
	}),
	fc
		.record({
			type: fc.constant(CollabMessageKind.Accepted),
			proposalId: fc.option(proposalIdArbitrary, { nil: undefined }),
			commit: commitArbitrary,
			update: bytesArbitrary,
			stateVector: bytesArbitrary,
		})
		.map(({ proposalId, ...message }) => {
			if (proposalId === undefined) return message;
			return { ...message, proposalId };
		}),
	fc.record({
		type: fc.constant(CollabMessageKind.Rejected),
		proposalId: proposalIdArbitrary,
		diagnostics: fc.array(diagnosticArbitrary, { maxLength: 8 }),
	}),
	fc.record({
		type: fc.constant(CollabMessageKind.ProtocolError),
		message: fc.string(),
	}),
);

describe('generated collaboration protocol messages', () => {
	it('property: decoding an encoded message is the identity (100 runs, arbitrary bytes and unicode)', () => {
		fc.assert(
			fc.property(messageArbitrary, (message) => {
				expect(decodeCollabMessage(encodeCollabMessage(message))).toEqual({
					ok: true,
					value: message,
				});
			}),
			{ numRuns: 100 },
		);
	});
});
