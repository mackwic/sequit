interface PropertyParameters {
	readonly numRuns: number;
	readonly seed?: number;
}

let propertyParameters: PropertyParameters = {
	numRuns: 200,
	seed: 1_592_915_777,
};
if (process.env['SEQUIT_PROPERTY_MODE'] === 'fuzz') {
	propertyParameters = { numRuns: 5_000 };
	const replaySeed = process.env['SEQUIT_PROPERTY_SEED'];
	if (replaySeed !== undefined) {
		propertyParameters = { ...propertyParameters, seed: Number(replaySeed) };
	}
}

export const PROPERTY_PARAMETERS = propertyParameters;
