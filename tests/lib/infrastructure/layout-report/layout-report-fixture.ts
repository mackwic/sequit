import { readFileSync } from 'node:fs';

import { anonymizeDocument } from '../../../../src/lib/core/document/anonymize-document';
import {
	LAYOUT_REPORT_SCHEMA,
	type LayoutReport,
	LayoutReportCategory,
	ReportedEntityKind,
} from '../../../../src/lib/infrastructure/layout-report/layout-report';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';

/** A well-formed report over the anonymized example document. */
export function validLayoutReport(): LayoutReport {
	const parsed = parseSequitToml(
		readFileSync(
			new URL('../../../../examples/ai-documentation.sequit.toml', import.meta.url),
			'utf8',
		),
	);
	if (!parsed.ok) throw new Error('The example document must parse');
	const document = serializeSequitToml(anonymizeDocument(parsed.value).document);
	const bounds = { x: 10, y: 20, width: 200, height: 80 };
	return {
		schemaVersion: LAYOUT_REPORT_SCHEMA,
		category: LayoutReportCategory.Crossing,
		comment: 'Deux relations se croisent sans raison',
		document,
		measurements: {
			nodes: [['e10', { width: 200, height: 80 }]],
			junctions: [['e20', { width: 28, height: 20 }]],
			groups: [['e30', { minimumWidth: 160, minimumHeight: 72, headerHeight: 36, padding: 36 }]],
		},
		layout: {
			width: 800,
			height: 600,
			nodes: [{ id: 'e10', bounds }],
			groups: [{ id: 'e30', bounds }],
			junctions: [{ id: 'e20', bounds }],
			relations: [{ id: 'e40', from: 'e10', to: 'e20', points: [{ x: 1, y: 2 }] }],
			lanes: [
				{ id: 'e50', bounds, regionId: 'e60' },
				{ id: 'e51', bounds },
			],
			regions: [{ id: 'e60', bounds }],
		},
		rendered: {
			width: 800,
			height: 600,
			zoom: 1.25,
			nodes: [{ id: 'e10', bounds }],
			groups: [],
			junctions: [],
			relations: [{ id: 'x0', path: 'M 0 0 L 10 0' }],
		},
		zones: [{ bounds, entities: [{ kind: ReportedEntityKind.Node, id: 'e10' }] }],
		checks: { anonymizationDiverged: false, projectionDiverged: true },
		environment: {
			userAgent: 'Mozilla/5.0',
			language: 'fr-FR',
			devicePixelRatio: 2,
			viewport: { width: 1440, height: 900 },
		},
	};
}
