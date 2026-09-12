import type { BoxIdentity } from '../harnesses/box-geometry';

export interface AssertionTargets {
	readonly boxes?: readonly string[];
	readonly routes?: readonly string[];
	readonly referenceBoxes?: readonly string[];
}

export interface AssertionContext {
	readonly subject: BoxIdentity;
	readonly reference?: BoxIdentity;
	readonly axis?: 'x' | 'y';
	readonly tolerance?: number;
	readonly difference?: number;
	readonly direction?: string;
}

interface DiagnosticOptions {
	readonly code: string;
	readonly context?: AssertionContext;
	readonly message?: string;
}

/** Structured diagnostic shared by executable visual assertions and their presentation. */
export class VisualAssertionError extends Error {
	readonly targets: AssertionTargets;
	readonly code: string;
	readonly context: AssertionContext | undefined;
	readonly subject: string;
	readonly expected: string | number;
	readonly actual: string | number;

	constructor(
		subject: string,
		expected: string | number,
		actual: string | number,
		targets: AssertionTargets = {},
		options: DiagnosticOptions = { code: 'visual.assertion' },
	) {
		super(options.message ?? `${subject}: attendu=${expected}, observé=${actual}.`);
		this.code = options.code;
		this.context = options.context;
		this.name = 'VisualAssertionError';
		this.targets = targets;
		this.subject = subject;
		this.expected = expected;
		this.actual = actual;
	}
}
