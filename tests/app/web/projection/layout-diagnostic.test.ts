import { expect, it } from 'vitest';

import {
	layoutDiagnostic,
	LayoutFailureReasonCode,
	LayoutProjectionError,
} from '../../../../src/app/web/projection/layout-diagnostic';
import {
	UnknownGridCellLayoutError,
	UnknownLayoutPresentationError,
	UnknownRegionLayoutError,
	UnsupportedGridCellLayoutError,
	UnsupportedLayoutPresentationError,
	UnsupportedRegionLayoutError,
} from '../../../../src/lib/core/layout/root-region';
import { validLogicDocument } from '../../../support/builders/logic-document';

it('uses canonical current-document facts independently of collection order', () => {
	const document = validLogicDocument();
	const permuted = {
		...document,
		nodes: [...document.nodes].reverse(),
		groups: [...document.groups].reverse(),
		junctions: [...document.junctions].reverse(),
		relations: [...document.relations].reverse(),
	};
	const first = layoutDiagnostic(document);

	expect(layoutDiagnostic(permuted)).toEqual(first);
	expect(first).toMatchObject({
		code: 'layout-failed',
		documentId: 'valid-document',
		title: 'Valid document',
		nodeIds: ['isolated', 'source-a', 'source-b', 'target'],
	});
});

it('exposes a stable reason only for recognized layout failures', () => {
	const document = validLogicDocument();
	const missing = layoutDiagnostic(document, new Error('Missing node measurement: source-a'));
	expect(missing.reason).toEqual({
		code: LayoutFailureReasonCode.MissingNodeMeasurement,
		elementId: 'source-a',
		message: 'Mesure manquante pour le nœud « source-a ».',
	});
	const unexpected = layoutDiagnostic(document, new Error('private implementation detail'));
	expect(unexpected.reason).toEqual({
		code: LayoutFailureReasonCode.CalculationFailed,
		message: 'Le moteur de mise en page n’a pas produit de géométrie valide.',
	});
});

it('identifies unsupported multi-lane layout by the core error type', () => {
	const document = validLogicDocument();
	expect(
		layoutDiagnostic(document, new UnsupportedLayoutPresentationError(document.id)).reason,
	).toEqual({
		code: LayoutFailureReasonCode.UnsupportedLaneLayout,
		message: 'Cette configuration de lanes n’est pas encore prise en charge.',
	});
	expect(
		layoutDiagnostic(document, new UnknownLayoutPresentationError(document.id, 'private geometry'))
			.reason,
	).toEqual({
		code: LayoutFailureReasonCode.UnknownLaneLayout,
		message: 'Le moteur n’a pas trouvé de géométrie validée pour ces lanes.',
	});
});

it('reports unresolved or unsupported region composition without leaking solver details', () => {
	const document = validLogicDocument();
	expect(
		layoutDiagnostic(document, new UnsupportedRegionLayoutError(document.id, 'private rule'))
			.reason,
	).toEqual({
		code: LayoutFailureReasonCode.UnsupportedRegionLayout,
		message: 'Cette configuration de régions n’est pas encore prise en charge.',
	});
	expect(
		layoutDiagnostic(document, new UnknownRegionLayoutError(document.id, 'private geometry'))
			.reason,
	).toEqual({
		code: LayoutFailureReasonCode.UnknownRegionLayout,
		message: 'Le moteur n’a pas trouvé de géométrie validée pour ces régions.',
	});
});

it('classifies unsupported and unresolved grid composition without leaking solver details', () => {
	const document = validLogicDocument();
	expect(
		layoutDiagnostic(document, new UnsupportedGridCellLayoutError(document.id, 'private rule'))
			.reason,
	).toEqual({
		code: LayoutFailureReasonCode.UnsupportedRegionLayout,
		message: 'Cette configuration de grille n’est pas encore prise en charge.',
	});
	expect(
		layoutDiagnostic(document, new UnknownGridCellLayoutError(document.id, 'private geometry'))
			.reason,
	).toEqual({
		code: LayoutFailureReasonCode.UnknownRegionLayout,
		message: 'Le moteur n’a pas trouvé de géométrie validée pour cette grille.',
	});
});

it('names missing group and junction measurements only when the identifier belongs to the current document', () => {
	const document = validLogicDocument();
	expect(
		layoutDiagnostic(document, new Error('Missing group measurement: container')).reason,
	).toEqual({
		code: LayoutFailureReasonCode.MissingGroupMeasurement,
		elementId: 'container',
		message: 'Mesure manquante pour le groupe « container ».',
	});
	expect(
		layoutDiagnostic(document, new Error('Missing junction measurement: choice')).reason,
	).toEqual({
		code: LayoutFailureReasonCode.MissingJunctionMeasurement,
		elementId: 'choice',
		message: 'Mesure manquante pour la jonction « choice ».',
	});
	expect(
		layoutDiagnostic(document, new Error('Missing node measurement: private-other-document-id'))
			.reason.code,
	).toBe(LayoutFailureReasonCode.CalculationFailed);
});

it('publishes a stable routing-cycle reason and hides arbitrary thrown details', () => {
	const document = validLogicDocument();
	expect(
		layoutDiagnostic(document, new Error('Unresolved channel routing constraint cycle')).reason,
	).toEqual({
		code: LayoutFailureReasonCode.RoutingConstraintCycle,
		message: 'Les contraintes de routage forment un cycle sans solution.',
	});
	const failure = new LayoutProjectionError(document, { secret: 'internal' });
	expect(failure.diagnostic.reason.code).toBe(LayoutFailureReasonCode.CalculationFailed);
	expect(failure.diagnostic.reason.message).not.toContain('secret');
	const errorFailure = new LayoutProjectionError(
		document,
		new Error('private implementation detail'),
	);
	expect(errorFailure.diagnostic.reason.code).toBe(LayoutFailureReasonCode.CalculationFailed);
});
