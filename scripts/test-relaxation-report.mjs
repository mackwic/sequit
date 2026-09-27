import { spawnSync } from 'node:child_process';

const base =
	process.argv[2] ?? process.env['TEST_RELAXATION_BASE'] ?? 'codex/layout-contract-generalization';
const diff = spawnSync('git', ['diff', '--no-ext-diff', '--unified=0', `${base}...HEAD`, '--'], {
	encoding: 'utf8',
});
if (diff.error) throw diff.error;
if (diff.status !== 0) {
	process.stderr.write(diff.stderr);
	process.exitCode = diff.status ?? 1;
} else {
	const report = [];
	let file = '';
	let oldLine = 0;
	let newLine = 0;
	const removedConstants = new Map();
	const constant = /\b([A-Za-z_$][\w$]*)\s*[:=]\s*([^,;\n]+)/;
	const budgetName = /budget|limit|threshold|max|performance|p95|slo|milliseconds|(?:^|_)ms$/i;
	for (const line of diff.stdout.split('\n')) {
		if (line.startsWith('+++ b/')) {
			file = line.slice(6);
			removedConstants.clear();
			continue;
		}
		if (line.startsWith('@@ ')) {
			const location = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
			if (location === null) continue;
			oldLine = Number(location[1]);
			newLine = Number(location[2]);
			removedConstants.clear();
			continue;
		}
		if (line.startsWith('--- ')) continue;
		if (line.startsWith('-')) {
			const body = line.slice(1);
			if (/\bexpect\s*(?:\.|\()/.test(body))
				report.push(`expect supprimé ${file}:${oldLine}: ${body.trim()}`);
			const match = constant.exec(body);
			if (match !== null && budgetName.test(match[1]))
				removedConstants.set(match[1], { value: match[2].trim(), line: oldLine });
			oldLine += 1;
			continue;
		}
		if (line.startsWith('+')) {
			const body = line.slice(1);
			if (
				/^\s*(?:(?:it|test|describe)\s*\.\s*(?:fails|skip|skipIf)|(?:xit|xtest|xdescribe))\s*\(/.test(
					body,
				)
			)
				report.push(`test neutralisé ${file}:${newLine}: ${body.trim()}`);
			const match = constant.exec(body);
			if (match !== null && budgetName.test(match[1])) {
				const previous = removedConstants.get(match[1]);
				if (previous !== undefined && previous.value !== match[2].trim())
					report.push(
						`plafond modifié ${file}:${previous.line}→${newLine}: ${match[1]} ${previous.value} → ${match[2].trim()}`,
					);
			}
			newLine += 1;
		}
	}
	process.stdout.write(`Rapport de relâchement (${base}...HEAD) :\n`);
	if (report.length === 0) process.stdout.write('Aucun item.\n');
	else process.stdout.write(`${report.join('\n')}\n`);
}
