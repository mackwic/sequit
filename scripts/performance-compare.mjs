import { readFileSync } from 'node:fs';

import { compareReports, formatComparison } from './performance-report.mjs';

try {
	const [beforePath, afterPath] = process.argv.slice(2);
	if (!beforePath || !afterPath)
		throw new Error('Usage : pnpm performance:compare avant.json après.json');
	const before = JSON.parse(readFileSync(beforePath, 'utf8'));
	const after = JSON.parse(readFileSync(afterPath, 'utf8'));
	const rows = compareReports(before, after);
	process.stdout.write(
		`Avant : ${before.source.commit} (${before.source.fingerprint})\nAprès : ${after.source.commit} (${after.source.fingerprint})\n\n`,
	);
	process.stdout.write(formatComparison(rows));
	if (rows.some((row) => row.status === 'Nouveau dépassement')) process.exitCode = 1;
} catch (error) {
	process.stderr.write(`${error.message}\n`);
	process.exitCode = 1;
}
