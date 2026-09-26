import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { arch, cpus, hostname, platform, release } from 'node:os';

export const performanceProtocolPaths = [
	'scripts/performance-context.mjs',
	'scripts/performance-record.mjs',
	'tests/support/harnesses/layout.ts',
	'tests/support/builders/layout-measurements.ts',
	'tests/support/performance',
	'tests/support/scenarios/layout-performance',
	'tests/support/builders/logic-document.ts',
	'src/app/workshop/fixtures/layout-performance',
	'tests/app/web/projection/performance/layout-graph-performance.test.ts',
	'tests/lib/core/layout/performance/incremental-layout-performance.test.ts',
	'tests/lib/infrastructure/collaboration/performance/live-edit-performance.test.ts',
	'tests/support/harnesses/memory-transport.ts',
	'package.json',
	'config/vitest.performance.config.ts',
	'pnpm-lock.yaml',
	'mise.toml',
];
const sourcePaths = [
	'src',
	'tests',
	'config',
	'scripts',
	'package.json',
	'pnpm-lock.yaml',
	'mise.toml',
];

export function git(...args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function fingerprint(paths) {
	const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...paths)
		.split('\0')
		.filter(Boolean);
	const hash = createHash('sha256');
	for (const file of [...new Set(files)].sort()) {
		hash.update(`${file}\0`);
		try {
			hash.update(readFileSync(file));
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
			hash.update('DELETED');
		}
		hash.update('\0');
	}
	return hash.digest('hex');
}

export function performanceProtocolFingerprint(paths = performanceProtocolPaths) {
	return fingerprint(paths);
}

export function sourceState() {
	return {
		commit: git('rev-parse', 'HEAD'),
		dirty: git('status', '--porcelain').length > 0,
		fingerprint: fingerprint(sourcePaths),
	};
}

export function performanceContext(suite, filter) {
	return {
		suite,
		filter,
		machine: {
			hostname: hostname(),
			platform: platform(),
			release: release(),
			arch: arch(),
			cpu: cpus()[0]?.model,
			cores: cpus().length,
		},
		runtime: {
			node: process.version,
			nodeOptions: process.env['NODE_OPTIONS'] ?? '',
			execArgv: process.execArgv,
			pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
		},
		protocol: fingerprint(performanceProtocolPaths),
	};
}

/** Best-effort check of known heavy validations, not a claim that the machine is idle. */
export function competingValidations(excludedRoot = process.pid) {
	const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8' }).split('\n');
	return findCompetingValidations(rows, excludedRoot);
}

export function findCompetingValidations(rows, excludedRoot) {
	const processes = rows.flatMap((line) => {
		const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
		if (!match) return [];
		return [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }];
	});
	const excluded = new Set([excludedRoot]);
	let previousSize;
	do {
		previousSize = excluded.size;
		for (const process of processes) if (excluded.has(process.parent)) excluded.add(process.pid);
	} while (previousSize !== excluded.size);
	return processes
		.filter((process) => !excluded.has(process.pid))
		.filter((process) =>
			/(?:^|[/\s(])(?:vitest(?:\.m?js)?|eslint(?:\.js)?|svelte-check|stryker|playwright|tsc)(?:[\s)]|$)|\/(?:@playwright\/test|playwright)\/(?:cli\.js|lib\/worker\/workerProcessEntry\.js)|vite(?:\.js)? build|pnpm (?:run )?(?:quality:|test:|check(?:\s|$))/.test(
				process.command,
			),
		)
		.map((process) => process.command);
}
