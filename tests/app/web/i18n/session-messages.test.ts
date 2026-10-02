import { afterEach, describe, expect, it } from 'vitest';

import { baseLocale, overwriteGetLocale } from '../../../../src/app/web/i18n/paraglide/runtime';
import {
	translateCommandDiagnostics,
	translateSessionError,
	translateSessionReason,
} from '../../../../src/app/web/i18n/session-messages';
import { SessionNoticeError } from '../../../../src/lib/infrastructure/collaboration/session-failure';
import {
	CommandRefusalCode,
	SessionFailureCode,
	SessionNoticeCode,
} from '../../../../src/lib/infrastructure/collaboration/session-reasons';
import { DocumentSessionError } from '../../../../src/lib/infrastructure/document/document-session-contracts';

function withLocale<T>(locale: 'fr' | 'en', run: () => T): T {
	overwriteGetLocale(() => locale);
	try {
		return run();
	} finally {
		overwriteGetLocale(() => baseLocale);
	}
}

afterEach(() => {
	overwriteGetLocale(() => baseLocale);
});

describe('session reason translations', () => {
	it('translates action refusals in French and English', () => {
		const reason = {
			code: SessionNoticeCode.ActionRefused,
			id: 'create-box',
			reason: { code: CommandRefusalCode.IdentifierExists },
		} as const;

		expect(withLocale('fr', () => translateSessionReason(reason))).toBe(
			'Action create-box refusée : Cet identifiant existe déjà.',
		);
		expect(withLocale('en', () => translateSessionReason(reason))).toBe(
			'Action create-box was rejected: This identifier already exists.',
		);
	});

	it('keeps English validation details after the translated invalid-document reason', () => {
		const detail = 'nodes.boxes.alpha.natureId must be a string';
		const commandReason = {
			code: CommandRefusalCode.InvalidDocument,
			details: [detail],
		} as const;
		const rejection = {
			code: SessionFailureCode.InvalidDocument,
			details: [detail],
		} as const;

		expect(withLocale('fr', () => translateSessionReason(commandReason))).toBe(
			`Document invalide. ${detail}`,
		);
		expect(withLocale('en', () => translateSessionReason(rejection))).toBe(
			`Invalid document. ${detail}`,
		);
	});

	it('keeps worker invalid-message rejections distinct from the session notice', () => {
		const rejection = {
			code: SessionFailureCode.InvalidMessage,
			details: ['Unexpected message property'],
		} as const;
		const notice = { code: SessionNoticeCode.InvalidMessage } as const;

		expect(withLocale('fr', () => translateSessionReason(rejection))).toBe(
			'Message invalide. Unexpected message property',
		);
		expect(withLocale('en', () => translateSessionReason(rejection))).toBe(
			'Invalid message. Unexpected message property',
		);
		expect(withLocale('fr', () => translateSessionReason(notice))).toBe(
			'La session a reçu un message invalide.',
		);
		expect(withLocale('en', () => translateSessionReason(notice))).toBe(
			'The live session received an invalid message.',
		);
	});

	it('wraps reasonless command diagnostics in a translated validation message', () => {
		const diagnostics = [
			{
				code: 'validation',
				message: 'relations.alpha.from must be a string',
				path: ['relations', 'alpha', 'from'],
			},
		];

		expect(withLocale('fr', () => translateCommandDiagnostics(diagnostics))).toBe(
			'Document invalide. relations.alpha.from must be a string',
		);
		expect(withLocale('en', () => translateCommandDiagnostics(diagnostics))).toBe(
			'Invalid document. relations.alpha.from must be a string',
		);
	});

	it('translates typed errors and prefixes unexpected English details', () => {
		const error = new SessionNoticeError({ code: SessionNoticeCode.ConnectionRequired });

		expect(withLocale('fr', () => translateSessionError(error))).toBe(
			'La session doit être connectée.',
		);
		expect(withLocale('en', () => translateSessionError(error))).toBe(
			'The live session must be connected.',
		);
		expect(
			withLocale('en', () =>
				translateSessionError(new DocumentSessionError({ code: SessionNoticeCode.Destroyed })),
			),
		).toBe('Document session has been destroyed');
		expect(withLocale('fr', () => translateSessionError(new Error('Socket unavailable')))).toBe(
			'Une erreur est survenue : Socket unavailable',
		);
		expect(withLocale('en', () => translateSessionError(new Error('Socket unavailable')))).toBe(
			'An error occurred: Socket unavailable',
		);
	});
});
