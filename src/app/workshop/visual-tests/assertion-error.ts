export interface AssertionTargets {
	readonly boxes?: readonly string[];
	readonly routes?: readonly string[];
}

/** Structured diagnostic shared by executable visual assertions and their presentation. */
export class VisualAssertionError extends Error {
	readonly targets: AssertionTargets;
	readonly subject: string;
	readonly expected: string | number;
	readonly actual: string | number;

	constructor(
		subject: string,
		expected: string | number,
		actual: string | number,
		targets: AssertionTargets = {},
	) {
		super(`${subject}: attendu=${expected}, observé=${actual}.`);
		this.name = 'VisualAssertionError';
		this.targets = targets;
		this.subject = subject;
		this.expected = expected;
		this.actual = actual;
	}
}
