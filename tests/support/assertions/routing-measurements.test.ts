import { expect, it } from 'vitest';

import { VisualAssertionError } from './assertion-error';
import { equalMetric, minimumMetric } from './routing-measurements';

it.each([NaN, Infinity, -Infinity])(
	'rejects invalid expectations %s even with a finite observation',
	(value) => {
		expect(() => {
			equalMetric('Metric', 10, value);
		}).toThrow('Expected metric must be finite');
		expect(() => {
			minimumMetric('Metric', 10, value);
		}).toThrow('Minimum metric must be finite');
		expect(() => {
			equalMetric('Metric', value, 10);
		}).toThrow(VisualAssertionError);
		expect(() => {
			minimumMetric('Metric', value, 10);
		}).toThrow(VisualAssertionError);
	},
);

it('keeps numerical tolerance distinct from the expected value', () => {
	equalMetric('Metric', 10.0005, 10);
	minimumMetric('Metric', 9.9995, 10);
	expect(() => {
		equalMetric('Metric', 10.002, 10);
	}).toThrow(VisualAssertionError);
	expect(() => {
		minimumMetric('Metric', 9.998, 10);
	}).toThrow(VisualAssertionError);
});
