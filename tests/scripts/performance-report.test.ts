import { describe, expect, it } from 'vitest';

import { findCompetingValidations } from '../../scripts/performance-context.mjs';
import {
	compareReports,
	formatComparison,
	validateReport,
} from '../../scripts/performance-report.mjs';
import { defined } from '../../src/lib/core/document/logic-document';

function report(values = [2, 12, 12, 2]) {
	return {
		version: 1,
		complete: true,
		context: {
			suite: 'snapshot',
			filter: '',
			machine: { cpu: 'test' },
			runtime: { node: '24' },
			protocol: 'same',
		},
		source: { commit: 'example' },
		measurements: values.map((observedMs, index) => ({
			scenario: `case-${index}`,
			size: 100,
			metric: 'medianMs',
			observedMs,
			budgetMs: 10,
			details: {},
		})),
	};
}

describe('performance comparisons', () => {
	it('separates new failures, existing failures, recoveries and passing cases', () => {
		const rows = compareReports(report(), report([12, 13, 9, 3]));
		expect(rows.map((row) => row.status)).toEqual([
			'Nouveau dépassement',
			'Dépassement déjà présent',
			'Retour dans le budget',
			'Dans le budget',
		]);
		expect(rows.map((row) => row.deltaMs)).toEqual([10, 1, -3, 1]);
		expect(formatComparison(rows)).toContain('Dépassement déjà présent');
	});
	it('treats equality with a strict budget as failure', () => {
		expect(compareReports(report([9]), report([10]))[0]?.status).toBe('Nouveau dépassement');
	});
	it.each(['suite', 'filter', 'machine', 'runtime', 'protocol'])(
		'rejects incompatible %s',
		(key) => {
			const before = report();
			const after = { ...report(), context: { ...report().context, [key]: 'different' } };
			expect(() => compareReports(before, after)).toThrow('incompatibles');
		},
	);
	it('rejects incomplete, empty, duplicate, missing, different and invalid measurements', () => {
		const base = report();
		const first = base.measurements[0];
		expect(() => {
			validateReport({ ...base, complete: false });
		}).toThrow('incomplet');
		expect(() => {
			validateReport({ ...base, measurements: [] });
		}).toThrow('Aucune');
		expect(() => {
			validateReport({ ...base, measurements: [first, first] });
		}).toThrow('dupliquée');
		expect(() => compareReports(base, report([2]))).toThrow('mêmes cas');
		const different = report();
		different.measurements[0] = { ...defined(different.measurements[0]), scenario: 'other' };
		expect(() => compareReports(base, different)).toThrow('absent');
		const budget = report();
		budget.measurements[0] = { ...defined(budget.measurements[0]), budgetMs: 100 };
		expect(() => compareReports(base, budget)).toThrow('budgets');
		const invalid = report([Number.NaN]);
		expect(() => {
			validateReport(invalid);
		}).toThrow('invalide');
		expect(() => {
			validateReport(report([-1]));
		}).toThrow('invalide');
	});
	it('ignores its own process tree, catches concurrent validations and allows an idle dev server', () => {
		const rows = [
			'100 1 node scripts/performance-record.mjs',
			'102 101 node /node_modules/vitest/vitest.mjs',
			'101 100 pnpm run test:performance',
			'202 200 node /node_modules/eslint/bin/eslint.js',
			'300 1 node /node_modules/vite/bin/vite.js dev',
			'400 1 node /editor/languages/eslint/server/eslintServer.js --stdio',
			'bad row',
		];
		expect(findCompetingValidations(rows, 100)).toEqual([
			'node /node_modules/eslint/bin/eslint.js',
		]);
	});
});
