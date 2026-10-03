import { describe, expect, it } from 'vitest';

import { parseLayoutReport } from '../../../../src/lib/infrastructure/layout-report/parse-layout-report';
import { validLayoutReport } from './layout-report-fixture';

/** A copy of `value` with the field at `path` replaced, as an untrusted body could arrive. */
function replaced(
	value: unknown,
	path: readonly (string | number)[],
	replacement: unknown,
): unknown {
	const [key, ...rest] = path;
	if (key === undefined) return replacement;
	if (Array.isArray(value)) {
		const items = Array.from<unknown>(value);
		items[Number(key)] = replaced(items[Number(key)], rest, replacement);
		return items;
	}
	const fields: Record<string, unknown> = Object.fromEntries(Object.entries(value ?? {}));
	return { ...fields, [key]: replaced(fields[String(key)], rest, replacement) };
}

function withField(path: readonly (string | number)[], value: unknown): unknown {
	return replaced(JSON.parse(JSON.stringify(validLayoutReport())), path, value);
}

describe('layout report parsing', () => {
	it('rebuilds a well-formed report from its known fields only', () => {
		const report = validLayoutReport();
		expect(parseLayoutReport({ ...report, extra: 'dropped' })).toEqual(report);
		const failed = {
			...report,
			layout: undefined,
			rendered: undefined,
			failure: 'missing-node-measurement',
		};
		expect(parseLayoutReport(failed)).toEqual(failed);
	});

	it('still reads reports sent before the visible area and the previous layout', () => {
		const report = validLayoutReport();
		if (report.rendered === undefined) throw new Error('The fixture reports a rendering');
		const { width, height, zoom, nodes, groups, junctions, relations } = report.rendered;
		const drawn = { width, height, zoom, nodes, groups, junctions, relations };
		const older = { ...report, previous: undefined, rendered: drawn };
		expect(parseLayoutReport(older)).toEqual(older);
	});

	it('refuses a document that still carries original texts or identifiers', () => {
		const document = validLayoutReport().document;
		expect(parseLayoutReport(withField(['document'], document.replace('"xxx"', '"Secret"')))).toBe(
			undefined,
		);
		expect(parseLayoutReport(withField(['document'], document.replace('e00', 'secret')))).toBe(
			undefined,
		);
		expect(parseLayoutReport(withField(['document'], 'not = [toml'))).toBeUndefined();
	});

	it.each([
		['an unknown schema', ['schemaVersion'], 2],
		['an unknown category', ['category'], 'ugly'],
		['a named identifier in the geometry', ['layout', 'nodes', 0, 'id'], 'secret-node'],
		['a named lane region', ['layout', 'lanes', 0, 'regionId'], 'secret-region'],
		['a named measured box', ['measurements', 'nodes', 0, 0], 'secret-node'],
		['a malformed measurement', ['measurements', 'groups', 0], ['e30']],
		['a non-finite coordinate', ['zones', 0, 'bounds', 'x'], null],
		['an unknown entity kind', ['zones', 0, 'entities', 0, 'kind'], 'lane'],
		['a free-text failure', ['failure'], 'The layout failed on « Secret »'],
		['a malformed rendering', ['rendered', 'relations', 0, 'path'], 42],
		['a malformed visible area', ['rendered', 'visible', 'width'], 'wide'],
		['a named identifier in the previous layout', ['previous', 'nodes', 0, 'id'], 'secret-node'],
		['a missing check', ['checks', 'projectionDiverged'], 'yes'],
		['a missing environment', ['environment', 'viewport'], undefined],
		['an overlong comment', ['comment'], 'x'.repeat(5_000)],
		['a non-object report', [], null],
	])('refuses %s', (_name, path, value) => {
		expect(parseLayoutReport(withField(path, value))).toBeUndefined();
	});
});
