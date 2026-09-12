import { spawn } from 'node:child_process';
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
	competingValidations,
	git,
	performanceContext,
	sourceState,
} from './performance-context.mjs';

async function record(suite, destination, filter = '') {
	const commands = { snapshot: 'test:performance', incremental: 'test:incremental-performance' };
	if (!Object.hasOwn(commands, suite) || !destination)
		throw new Error(
			'Usage : pnpm performance:record snapshot|incremental /chemin/rapport.json [filtre Vitest]',
		);
	const output = resolve(destination);
	const auxiliary = {
		measurements: `${output}.measurements.json`,
		tests: `${output}.tests.json`,
		log: `${output}.log`,
	};
	for (const path of [output, ...Object.values(auxiliary)])
		if (existsSync(path)) throw new Error(`Le fichier existe déjà : ${path}`);
	const lock = resolve(git('rev-parse', '--git-common-dir'), 'sequit-performance.lock');
	// mkdir is atomic and shared by all worktrees of this repository.
	mkdirSync(lock);
	try {
		const competing = competingValidations();
		if (competing.length)
			throw new Error(
				`Une validation tourne déjà. Attendre sa fin avant de mesurer.\n${competing.join('\n')}`,
			);
		mkdirSync(dirname(output), { recursive: true });
		const context = performanceContext(suite, filter);
		const source = sourceState();
		const startedAt = new Date().toISOString();
		const args = ['run', commands[suite], '--reporter=json', `--outputFile=${auxiliary.tests}`];
		if (filter) args.push('--testNamePattern', filter);
		process.stdout.write(`Mesure ${suite}. Journal : ${auxiliary.log}\n`);
		const log = openSync(auxiliary.log, 'wx');
		const contamination = new Set();
		let result;
		try {
			result = await new Promise((resolveRun, reject) => {
				const child = spawn('pnpm', args, {
					stdio: ['ignore', log, log],
					env: { ...process.env, SEQUIT_PERFORMANCE_MEASUREMENTS: auxiliary.measurements },
				});
				const monitor = setInterval(() => {
					try {
						for (const command of competingValidations()) contamination.add(command);
					} catch (error) {
						contamination.add(error.message);
					}
				}, 2000);
				child.on('error', (error) => {
					clearInterval(monitor);
					reject(error);
				});
				child.on('close', (status, signal) => {
					clearInterval(monitor);
					resolveRun({ status, signal });
				});
			});
		} finally {
			closeSync(log);
		}
		const measurements = JSON.parse(readFileSync(auxiliary.measurements, 'utf8'));
		const tests = JSON.parse(readFileSync(auxiliary.tests, 'utf8'));
		const completed = tests.testResults
			.flatMap((test) => test.assertionResults)
			.filter((test) => ['passed', 'failed'].includes(test.status));
		const represented = completed.every((test) =>
			measurements.some(
				(row) => test.title === row.scenario || test.title === `${row.scenario}/nodes=${row.size}`,
			),
		);
		const unchanged = source.fingerprint === sourceState().fingerprint;
		const complete =
			measurements.length > 0 &&
			represented &&
			unchanged &&
			result.signal === null &&
			contamination.size === 0;
		const report = {
			version: 1,
			complete,
			startedAt,
			finishedAt: new Date().toISOString(),
			context,
			source,
			exitCode: result.status,
			measurements,
			conditions: {
				knownValidationsBefore: competing,
				knownValidationsDuring: [...contamination],
				sourceUnchanged: unchanged,
				note:
					process.env['SEQUIT_PERFORMANCE_NOTE'] ??
					'Conditions de charge et alimentation non renseignées.',
			},
		};
		writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
		process.stdout.write(
			`Rapport : ${output}\n${measurements.length} mesures. Code du test : ${result.status}.\n`,
		);
		if (!complete)
			throw new Error(
				'Mesure incomplète ou sources modifiées ou validation concurrente pendant la mesure. Rapport non comparable.',
			);
		process.exitCode = result.status ?? 1;
	} finally {
		rmSync(lock, { recursive: true });
	}
}

try {
	await record(...process.argv.slice(2));
} catch (error) {
	process.stderr.write(`${error.message}\n`);
	process.exitCode = 1;
}
