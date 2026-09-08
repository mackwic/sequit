import fc from 'fast-check';
import { expect, it } from 'vitest';

import {
	emptyFeedback,
	parseWorkshopFeedback,
	workshopFeedbackMarkdown,
} from '../../src/routes/atelier/runtime/workshop-feedback';

it('loads only complete string entries and leaves valid notes intact among malformed entries', () => {
	const valid = { ...emptyFeedback, notes: 'Une observation complète.' };
	const bad: Record<string, unknown> = { null: null, scalar: 1, missing: {} };
	for (const key of Object.keys(emptyFeedback)) {
		bad[key] = { ...emptyFeedback, [key]: false };
		const missing = Object.fromEntries(
			Object.entries(emptyFeedback).filter(([field]) => field !== key),
		);
		bad[`missing-${key}`] = missing;
	}
	expect(parseWorkshopFeedback(JSON.stringify({ good: valid, ...bad }))).toEqual({ good: valid });
	for (const source of [null, 'null', '2', '"text"', '[]'])
		expect(parseWorkshopFeedback(source)).toEqual({});
	expect(() => parseWorkshopFeedback('{invalid')).toThrow();
	expect(Object.keys(parseWorkshopFeedback(`{"__proto__":${JSON.stringify(valid)}}`))).toEqual([
		'__proto__',
	]);
});

it('roundtrips arbitrary notes and exports all scenarios, including empty questionnaires', () => {
	fc.assert(
		fc.property(fc.string(), (notes) => {
			const records = {
				scenario: {
					...emptyFeedback,
					notes,
					tested: 'modal',
					preference: 'inline',
					next: 'Plus près',
				},
			};
			expect(parseWorkshopFeedback(JSON.stringify(records))).toEqual(records);
			const markdown = workshopFeedbackMarkdown(
				[
					{ id: 'scenario', label: 'Édition' },
					{ id: 'next', label: 'Suite' },
				],
				records,
			);
			expect(markdown).toContain(`Observations :\n${notes}\n`);
			expect(markdown).toContain('Variantes essayées : modal');
			expect(markdown).toContain('Préférence : inline');
			expect(markdown).toContain('## next — Suite');
			expect(markdown).toContain('À changer au prochain essai :\nPlus près');
		}),
	);
});
