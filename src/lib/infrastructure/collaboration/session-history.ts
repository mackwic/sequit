import type * as Y from 'yjs';

import type { LogicDocument } from '../../core/document/logic-document';
import {
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
} from '../document/document-command-contracts';
import type {
	DocumentHistory,
	DocumentHistoryAvailability,
} from '../document/document-session-contracts';
import { type HistoryCrossing, restoreHistoryStep } from '../document/history-restoration';
import type { SharedDocumentCommand, SharedTarget } from '../document/shared-document-command';
import {
	type SourceDocumentState,
	SourceDocumentStateKind,
} from './collaborative-document-session-types';
import { notifySubscribers, subscribeToSet } from './notify-subscribers';
import type { TextEditRecorder } from './session-text-edits';

enum HistoryStepKind {
	Structure = 'structure',
	Text = 'text',
}

/** A batch the room accepted, as the documents just before and just after its commit. */
interface StructureStep {
	readonly kind: HistoryStepKind.Structure;
	readonly before: LogicDocument;
	readonly after: LogicDocument;
}

/** Consecutive edits of one text field; the latest edit extends `after`. */
interface TextStep {
	readonly kind: HistoryStepKind.Text;
	readonly key: string;
	readonly target: SharedTarget;
	readonly field: string;
	readonly before: string;
	after: string;
}

type HistoryStep = StructureStep | TextStep;

/** An undo or redo proposed to the room, until it decides. */
interface PendingRestoration {
	/** The proposed batch, which the room commits as this very array. */
	readonly commands: readonly SharedDocumentCommand[];
	readonly step: StructureStep;
	readonly undo: boolean;
	/** A newer step was made meanwhile: an undone step no longer goes to the steps to redo. */
	superseded: boolean;
}

enum RestoreOutcome {
	Applied = 'applied',
	Proposed = 'proposed',
	/** Nothing is left to restore: the step is dropped and the next one is tried. */
	Skipped = 'skipped',
	/** The session cannot restore right now: the step stays for a later attempt. */
	Unavailable = 'unavailable',
}

/** What the history needs from the session that owns it, as `DocumentSession` offers it. */
export interface SessionHistoryPort {
	readSourceState(): SourceDocumentState;
	/** Throws when the session takes no commands right now. */
	dispatch(commands: readonly SharedDocumentCommand[]): Promise<DocumentCommandOutcome>;
	text(target: SharedTarget, field: string): Y.Text | undefined;
	/** Returns false when the text is not editable right now. */
	updateText(target: SharedTarget, field: string, next: string): boolean;
}

/**
 * The history of one collaborative session's own edits. Undoing a structural step proposes the
 * batch that restores what it changed, and redoing proposes the batch that restores what it made;
 * the room decides like for any batch, and the step changes stack once its commit arrives. A text
 * step gathers consecutive edits of one field until anything else happens, and is restored through
 * the field's `Y.Text`. Other participants' later edits elsewhere stay. A step with nothing left to
 * restore is skipped, and one the room refuses is dropped.
 */
export class SessionHistory implements DocumentHistory, TextEditRecorder {
	readonly #undo: HistoryStep[] = [];
	readonly #redo: HistoryStep[] = [];
	readonly #listeners = new Set<(availability: DocumentHistoryAvailability) => void>();
	#pending: PendingRestoration | undefined;
	/** The text field whose edits still extend the latest step. */
	#openText: string | undefined;
	#restoringText = false;

	constructor(private readonly port: SessionHistoryPort) {}

	availability(): DocumentHistoryAvailability {
		const idle = this.#pending === undefined;
		return { undo: idle && this.#undo.length > 0, redo: idle && this.#redo.length > 0 };
	}

	subscribe(listener: (availability: DocumentHistoryAvailability) => void): () => void {
		return subscribeToSet(this.#listeners, listener);
	}

	undo(): boolean {
		return this.#restore(this.#undo, this.#redo, true);
	}

	redo(): boolean {
		return this.#restore(this.#redo, this.#undo, false);
	}

	/**
	 * One of this session's batches, committed by the room, with the source states on either side
	 * of its commit. A batch between states that are not both valid documents makes no step.
	 */
	committed(
		commands: readonly SharedDocumentCommand[],
		before: SourceDocumentState,
		after: SourceDocumentState,
	): void {
		const pending = this.#pending;
		if (pending?.commands === commands) {
			this.#pending = undefined;
			this.#openText = undefined;
			if (!pending.undo) this.#undo.push(pending.step);
			else if (!pending.superseded) this.#redo.push(pending.step);
			this.#notify();
			return;
		}
		if (before.kind !== SourceDocumentStateKind.Valid) return;
		if (after.kind !== SourceDocumentStateKind.Valid) return;
		this.#record({
			kind: HistoryStepKind.Structure,
			before: before.document,
			after: after.document,
		});
	}

	/** A local edit of a text field, from `before` to `after`. */
	textEdited(target: SharedTarget, field: string, before: string, after: string): void {
		if (this.#restoringText || before === after) return;
		const key = JSON.stringify([target.kind, target.id, field]);
		const last = this.#undo.at(-1);
		if (last?.kind === HistoryStepKind.Text && this.#openText === key) {
			last.after = after;
			return;
		}
		this.#record({ kind: HistoryStepKind.Text, key, target, field, before, after });
		this.#openText = key;
	}

	clear(): void {
		this.#undo.length = 0;
		this.#redo.length = 0;
		this.#pending = undefined;
		this.#openText = undefined;
		this.#notify();
	}

	#record(step: HistoryStep): void {
		this.#undo.push(step);
		this.#redo.length = 0;
		this.#openText = undefined;
		if (this.#pending !== undefined) this.#pending.superseded = true;
		this.#notify();
	}

	#restore(source: HistoryStep[], target: HistoryStep[], undo: boolean): boolean {
		if (this.#pending !== undefined) return false;
		this.#openText = undefined;
		let restored = false;
		for (let step = source.at(-1); step !== undefined && !restored; step = source.at(-1)) {
			const outcome = this.#apply(step, undo);
			if (outcome === RestoreOutcome.Unavailable) break;
			source.pop();
			if (outcome === RestoreOutcome.Applied) target.push(step);
			restored = outcome !== RestoreOutcome.Skipped;
		}
		this.#notify();
		return restored;
	}

	#apply(step: HistoryStep, undo: boolean): RestoreOutcome {
		if (step.kind === HistoryStepKind.Text) return this.#applyText(step, undo);
		const current = this.port.readSourceState();
		if (current.kind !== SourceDocumentStateKind.Valid) return RestoreOutcome.Unavailable;
		let crossing: HistoryCrossing = { from: step.before, to: step.after };
		if (undo) crossing = { from: step.after, to: step.before };
		const commands = restoreHistoryStep(crossing, current.document);
		if (commands.length === 0) return RestoreOutcome.Skipped;
		try {
			void this.port.dispatch(commands).then((outcome) => {
				this.#decided(commands, outcome.kind === DocumentCommandOutcomeKind.Accepted);
			});
		} catch {
			return RestoreOutcome.Unavailable;
		}
		this.#pending = { commands, step, undo, superseded: false };
		return RestoreOutcome.Proposed;
	}

	/** A refused undo or redo cannot be restored any more: its step is dropped. */
	#decided(commands: readonly SharedDocumentCommand[], accepted: boolean): void {
		if (accepted || this.#pending?.commands !== commands) return;
		this.#pending = undefined;
		this.#notify();
	}

	#applyText(step: TextStep, undo: boolean): RestoreOutcome {
		if (this.port.text(step.target, step.field) === undefined) return RestoreOutcome.Skipped;
		let text = step.after;
		if (undo) text = step.before;
		this.#restoringText = true;
		try {
			if (!this.port.updateText(step.target, step.field, text)) return RestoreOutcome.Unavailable;
		} finally {
			this.#restoringText = false;
		}
		return RestoreOutcome.Applied;
	}

	#notify(): void {
		notifySubscribers(this.#listeners, this.availability());
	}
}
