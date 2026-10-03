import type Quill from 'quill';
import { untrack } from 'svelte';

import type { LogicDocument, LogicNature } from '../../../../../lib/core/document/logic-document';
import { firstNature } from '../../../../../lib/core/document/nature-families';
import type { Bounds } from '../../../../../lib/core/layout/layout-types';
import { DocumentCommandOutcomeKind } from '../../../../../lib/infrastructure/document/document-command-contracts';
import type { SharedDocumentCommand } from '../../../../../lib/infrastructure/document/shared-document-command';
import { connectedNodeCreation } from '../../../document/document-commands';
import { NODE_TEXT_PLACEHOLDERS } from '../../../document/node-text';
import { mountQuillMarkdown } from '../../../document/quill-editor';
import { QuillEditorProfile } from '../../../document/quill-editor-config';
import { m } from '../../../i18n/paraglide/messages';
import {
	type CanvasDrafts,
	NO_CANVAS_DRAFTS,
	type NodeDraft,
	type NodeTextDraft,
	withNodeDrafts,
} from '../../../projection/node-draft';
import { EntityKind, type EntityRef } from '../../canvas/canvas-entity';
import type { CanvasModel } from '../../canvas/canvas-model';
import { type NodeCreationRequest, planNodeCreation } from '../../canvas/relative-node-creation';
import {
	CanvasEditPresentation,
	type CanvasSession,
	type EditingCanvasActivity,
} from '../../session/canvas-session.svelte';

/** The text editor of a box typed in place, mounted in the box's body. */
interface TypedText {
	readonly quill: Quill;
	readonly destroy: () => void;
}

/** Mounts the editor of a box typed in place on `host`, named `label`. */
export type MountTypedText = (host: HTMLElement, label: string) => Promise<TypedText>;

/** What the canvas needs to show a box typed in place, new or existing, and to act on it. */
export interface NodeDraftControls {
	readonly id: string;
	/** Accessible names of the box and of its text. */
	readonly label: string;
	readonly textLabel: string;
	readonly mount: MountTypedText;
	/** Why the last save was refused; the box stays typed meanwhile. */
	readonly diagnostic: string | undefined;
	/** Saves or creates the box, then selects it. An empty new box is dropped. */
	readonly commit: () => void;
	/** Saves or creates the box and starts typing a child of it. */
	readonly child: () => void;
	/** Saves or creates the box, then opens its dialog. */
	readonly edit: () => void;
	/** The author went elsewhere: the box is saved or created, and left alone. */
	readonly leave: () => void;
	readonly cancel: () => void;
}

export interface NodeTypingHost {
	/** The shared document, without drafts. */
	read(): LogicDocument;
	/** Proposes one batch and resolves with its acceptance; the host reports a refusal. */
	submit(commands: readonly SharedDocumentCommand[]): Promise<boolean>;
	readonly session: CanvasSession;
	/** The last laid-out canvas, which gives a box its bounds for the dialog. */
	canvas(): CanvasModel | undefined;
	/**
	 * Binds the text of an existing box live, where texts are shared as they are typed; without
	 * it, the text is saved when the box is left.
	 */
	readonly sharedText?: ((nodeId: string) => MountTypedText) | undefined;
}

interface TypedDraft {
	readonly draft: NodeDraft;
	readonly markdown: string;
	/** The element the box was typed from; it gets the selection and focus back on cancel. */
	readonly origin?: EntityRef | undefined;
}

enum AfterCreation {
	Nothing,
	Select,
	Edit,
}

function mountText(
	host: HTMLElement,
	label: string,
	value: string,
	onchange: (markdown: string) => void,
): Promise<TypedText> {
	return mountQuillMarkdown(host, {
		profile: QuillEditorProfile.Inline,
		label,
		placeholder: NODE_TEXT_PLACEHOLDERS.inline,
		value,
		onchange,
	}).then((field) => ({
		quill: field.editor.quill,
		destroy: () => {
			field.destroy();
		},
	}));
}

/**
 * Boxes are typed in place. A new box is a draft local to this view until its creation is
 * accepted; the document then holds it at the same place, under the same identifier. An existing
 * box is typed through the session's edit, which saves it.
 */
export class NodeTyping {
	/** The nature new boxes take; the document's first stands in while it is unset or removed. */
	natureId = $state<string>();
	#typing = $state.raw<TypedDraft>();
	/** Proposed boxes that the document does not hold yet; they stay drawn meanwhile. */
	#pending = $state.raw<readonly NodeDraft[]>([]);
	readonly #host: NodeTypingHost;
	readonly #typingId = $derived(this.#typing?.draft.node.id);
	readonly #editedId = $derived.by(() => {
		const editing = this.#host.session.editing;
		if (editing?.presentation !== CanvasEditPresentation.InPlace) return undefined;
		return editing.nodeId;
	});

	constructor(host: NodeTypingHost) {
		this.#host = host;
	}

	/** Proposed boxes, then the typed one sized for its placeholder. */
	readonly #nodes = $derived.by((): readonly NodeDraft[] => {
		const typing = this.#typing;
		if (typing === undefined) return this.#pending;
		const markdown = typing.markdown || NODE_TEXT_PLACEHOLDERS.inline;
		return [...this.#pending, { ...typing.draft, node: { ...typing.draft.node, markdown } }];
	});

	/** An existing box typed in place is measured as typed, unless its text is already shared. */
	readonly #texts = $derived.by((): readonly NodeTextDraft[] => {
		const editing = this.#host.session.editing;
		const typed =
			editing?.presentation === CanvasEditPresentation.InPlace &&
			this.#host.sharedText === undefined;
		if (editing === undefined || !typed) return NO_CANVAS_DRAFTS.texts;
		const markdown = editing.draft.markdown || NODE_TEXT_PLACEHOLDERS.inline;
		return [{ nodeId: editing.nodeId, markdown }];
	});

	/** What the projection draws on top of the document. */
	readonly drafts = $derived.by((): CanvasDrafts => ({ nodes: this.#nodes, texts: this.#texts }));

	readonly controls = $derived.by((): NodeDraftControls | undefined => {
		const id = this.#typingId;
		if (id !== undefined) return this.#draftControls(id);
		const edited = this.#editedId;
		if (edited !== undefined) return this.#editControls(edited);
		return undefined;
	});

	/** The nature of the next box. */
	nature(natures: readonly LogicNature[]): LogicNature | undefined {
		return natures.find(({ id }) => id === this.natureId) ?? firstNature(natures);
	}

	/** Starts typing a new box; `false` without nature, without target, or while a box is edited. */
	open(request: NodeCreationRequest): boolean {
		if (this.#host.session.editing !== undefined) return false;
		const document = withNodeDrafts(this.#host.read(), this.#pending);
		const plan = planNodeCreation(document, request, {
			nodeId: crypto.randomUUID(),
			relationId: () => crypto.randomUUID(),
			natureId: this.nature(document.natures)?.id,
		});
		if (plan === undefined) return false;
		const origin = request.target ?? request.near ?? request.sibling;
		this.#typing = { draft: plan, markdown: '', origin };
		this.#host.session.clearSelection();
		return true;
	}

	/** Types an existing box in place, as a double-click or Enter on it does. */
	typeInPlace(node: { readonly id: string; readonly bounds: Bounds }): boolean {
		const { session } = this.#host;
		session.selectEntity({ kind: EntityKind.Node, id: node.id });
		return session.beginNodeEdit(node, CanvasEditPresentation.InPlace);
	}

	/** Forgets proposed boxes once the document holds them. */
	settle(document: LogicDocument): void {
		const pending = untrack(() => this.#pending);
		const kept = pending.filter(({ node }) => !document.nodes.some(({ id }) => id === node.id));
		if (kept.length !== pending.length) this.#pending = kept;
	}

	#draftControls(id: string): NodeDraftControls {
		/** Controls that outlive their box, while the next one comes up, act on nothing. */
		const typed = (): TypedDraft | undefined => {
			const typing = this.#typing;
			if (typing?.draft.node.id === id) return typing;
			return undefined;
		};
		const create = (after: AfterCreation): void => {
			const typing = typed();
			if (typing !== undefined) void this.#create(typing, after);
		};
		const markdown = untrack(() => this.#typing?.markdown ?? '');
		return {
			id,
			label: m.common_new_box(),
			textLabel: m.editing_draft_content(),
			mount: (host, label) =>
				mountText(host, label, markdown, (next) => {
					const typing = typed();
					if (typing !== undefined) this.#typing = { ...typing, markdown: next };
				}),
			diagnostic: undefined,
			commit: () => {
				create(AfterCreation.Select);
			},
			child: () => {
				const typing = typed();
				if (typing !== undefined) this.#createWithChild(typing);
			},
			edit: () => {
				create(AfterCreation.Edit);
			},
			leave: () => {
				create(AfterCreation.Nothing);
			},
			cancel: () => {
				const typing = typed();
				if (typing !== undefined) this.#cancel(typing);
			},
		};
	}

	#editControls(id: string): NodeDraftControls {
		const { session } = this.#host;
		/** Controls that outlive the edit act on nothing. */
		const editing = (): EditingCanvasActivity | undefined => {
			const current = session.editing;
			if (current?.nodeId !== id || current.presentation !== CanvasEditPresentation.InPlace)
				return undefined;
			return current;
		};
		const ref = { kind: EntityKind.Node, id } as const;
		const markdown = untrack(() => editing()?.draft.markdown ?? '');
		let mount: MountTypedText = (host, label) =>
			mountText(host, label, markdown, (next) => {
				if (editing() !== undefined) session.updateDraft({ markdown: next });
			});
		if (this.#host.sharedText !== undefined) mount = this.#host.sharedText(id);
		return {
			id,
			label: m.editing_typed_box(),
			textLabel: m.editing_typed_content(),
			mount,
			get diagnostic() {
				return editing()?.diagnostic;
			},
			commit: () => {
				if (editing() !== undefined) void session.saveDraft();
			},
			child: () => {
				if (editing() === undefined) return;
				void this.#saved(() => {
					this.open({ target: ref });
				});
			},
			edit: () => {
				if (editing() === undefined) return;
				void this.#saved(() => {
					const node = this.#host.canvas()?.nodes.find((item) => item.id === id);
					if (node !== undefined) session.beginNodeEdit(node);
				});
			},
			leave: () => {
				if (editing() !== undefined) void session.saveDraft({ restoreFocus: false });
			},
			cancel: () => {
				if (editing() !== undefined) session.cancel();
			},
		};
	}

	/** Saves the box typed in place, then carries on once the save is accepted. */
	async #saved(then: () => void): Promise<void> {
		const outcome = await this.#host.session.saveDraft({ restoreFocus: false });
		if (outcome?.kind === DocumentCommandOutcomeKind.Accepted) then();
	}

	#cancel(typing: TypedDraft): void {
		this.#typing = undefined;
		if (typing.origin !== undefined) this.#host.session.focusEntity(typing.origin);
	}

	#createWithChild(parent: TypedDraft): void {
		if (parent.markdown.trim() === '') return;
		void this.#create(parent, AfterCreation.Nothing);
		this.open({ target: { kind: EntityKind.Node, id: parent.draft.node.id } });
	}

	/** An empty box is not created: confirming it cancels it, leaving it drops it. */
	async #create(typing: TypedDraft, after: AfterCreation): Promise<void> {
		const markdown = typing.markdown.trim();
		if (markdown === '') {
			if (after === AfterCreation.Nothing) this.#typing = undefined;
			else this.#cancel(typing);
			return;
		}
		this.#typing = undefined;
		const draft: NodeDraft = { ...typing.draft, node: { ...typing.draft.node, markdown } };
		this.#pending = [...this.#pending, draft];
		if (await this.#host.submit(connectedNodeCreation(draft.node, draft.relations)))
			this.#created(draft.node.id, after);
		else this.#refused(typing);
	}

	#created(id: string, after: AfterCreation): void {
		const ref = { kind: EntityKind.Node, id } as const;
		const { session } = this.#host;
		if (after === AfterCreation.Select) session.focusEntity(ref);
		if (after !== AfterCreation.Edit) return;
		session.selectEntity(ref);
		const node = this.#host.canvas()?.nodes.find((item) => item.id === id);
		if (node !== undefined) session.beginNodeEdit(node);
	}

	/** A refused box comes back to be typed, unless another one is under way; its children go. */
	#refused(typing: TypedDraft): void {
		const id = typing.draft.node.id;
		this.#pending = this.#pending.filter(({ node }) => node.id !== id);
		if (this.#typing?.draft.relations.some(({ to }) => to === id) === true)
			this.#typing = undefined;
		this.#typing ??= typing;
	}
}
