import { randomUUID } from 'node:crypto';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	competingValidations,
	findCompetingValidations,
	performanceContext,
	performanceProtocolFingerprint,
	performanceProtocolPaths,
	sourceState,
} from '../../scripts/performance-context.mjs';
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
	it('records the machine, runtime, source and live-edit protocol in reports', () => {
		const context = performanceContext('collaboration-live-edit', '3,200 nodes');
		expect(context.suite).toBe('collaboration-live-edit');
		expect(context.filter).toBe('3,200 nodes');
		expect(context.machine.arch.length).toBeGreaterThan(0);
		expect(context.machine.cpu).toBeDefined();
		expect(context.runtime.node).toMatch(/^v\d+/);
		expect(context.runtime.pnpm).toMatch(/^\d+/);
		expect(context.protocol).toBe(performanceProtocolFingerprint());
		const state = sourceState();
		expect(state.commit).toMatch(/^[a-f0-9]{40}$/);
		expect(typeof state.dirty).toBe('boolean');
		expect(state.fingerprint).toMatch(/^[a-f0-9]{64}$/);
	});
	it('changes the protocol fingerprint when a previously readable workspace path disappears', () => {
		const directory = mkdtempSync(join('tests', `performance-protocol-${randomUUID()}-`));
		const target = join(directory, 'target.ts');
		const workload = join(directory, 'workload.ts');
		try {
			writeFileSync(target, 'sampleCount = 11');
			symlinkSync('target.ts', workload);
			const readableProtocol = performanceProtocolFingerprint([workload]);
			unlinkSync(target);
			const deletedProtocol = performanceProtocolFingerprint([workload]);
			expect(deletedProtocol).not.toBe(readableProtocol);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
	it('checks the process list while excluding its own tree and idle servers', () => {
		const directory = mkdtempSync(join('tests', `performance-ps-${randomUUID()}-`));
		const executable = join(directory, 'ps');
		const previousPath = process.env['PATH'];
		const childPid = process.pid + 1;
		writeFileSync(
			executable,
			`#!/bin/sh\nprintf "%s\\n" "${process.pid} 1 node vitest" "${childPid} ${process.pid} node /node_modules/vitest/vitest.mjs" "202 200 node /node_modules/eslint/bin/eslint.js" "300 1 node /node_modules/vite/bin/vite.js dev"\n`,
		);
		chmodSync(executable, 0o755);
		process.env['PATH'] = directory;
		try {
			expect(competingValidations()).toEqual(['node /node_modules/eslint/bin/eslint.js']);
		} finally {
			if (previousPath === undefined) delete process.env['PATH'];
			else process.env['PATH'] = previousPath;
			rmSync(directory, { recursive: true, force: true });
		}
	});
	it('rethrows failures other than a missing performance input', () => {
		const directory = mkdtempSync(join('tests', `performance-protocol-${randomUUID()}-`));
		const inputDirectory = join(directory, 'input');
		const workload = join(directory, 'workload.ts');
		try {
			mkdirSync(inputDirectory);
			symlinkSync('input', workload);
			expect(() => performanceProtocolFingerprint([workload])).toThrow(
				expect.objectContaining({ code: 'EISDIR' }),
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
	it('invalidates comparisons when the collaborative live-edit workload changes', () => {
		expect(performanceProtocolPaths).toContain(
			'tests/lib/infrastructure/collaboration/performance/live-edit-performance.test.ts',
		);
		expect(performanceProtocolPaths).toContain('tests/support/harnesses/memory-transport.ts');
		expect(performanceProtocolPaths).toContain('package.json');
		const directory = mkdtempSync(join('tests', `performance-protocol-${randomUUID()}-`));
		const workload = join(directory, 'workload.ts');
		try {
			writeFileSync(workload, 'sampleCount = 11');
			const beforeProtocol = performanceProtocolFingerprint([workload]);
			writeFileSync(workload, 'sampleCount = 12');
			const afterProtocol = performanceProtocolFingerprint([workload]);
			expect(afterProtocol).not.toBe(beforeProtocol);
			const before = {
				...report(),
				context: { ...report().context, protocol: beforeProtocol },
			};
			const after = {
				...report(),
				context: { ...report().context, protocol: afterProtocol },
			};
			expect(() => compareReports(before, after)).toThrow('protocol');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
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
