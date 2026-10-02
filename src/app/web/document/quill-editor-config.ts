import type { QuillOptions } from 'quill';

export enum QuillEditorProfile {
	Plain = 'plain',
	Body = 'body',
	/** The body typed in place on the canvas: the same formats, by their keys, no toolbar. */
	Inline = 'inline',
	Description = 'description',
}

export interface QuillFieldOptions {
	/** Shown while the field is empty. */
	readonly placeholder?: string | undefined;
	/** Adds a « Texte source » toolbar button to descriptions. */
	readonly showSource?: (() => void) | undefined;
}

/** Tab moves to the next field of the dialog instead of indenting; `null` drops a default binding. */
const TAB_LEAVES_FIELD: Readonly<Record<string, null>> = {
	tab: null,
	indent: null,
	outdent: null,
	'remove tab': null,
	'indent code-block': null,
	'outdent code-block': null,
	'table tab': null,
};

/** The body stays compact; descriptions may use the editor's larger Markdown subset. */
export function quillEditorOptions(
	profile: QuillEditorProfile,
	{ placeholder, showSource }: QuillFieldOptions = {},
): QuillOptions {
	let formats = ['bold', 'italic', 'underline'];
	let toolbar: QuillOptions['modules'] = { toolbar: [['bold', 'italic', 'underline'], ['clean']] };
	if (profile === QuillEditorProfile.Plain) {
		formats = [];
		toolbar = { toolbar: false };
	}
	if (profile === QuillEditorProfile.Inline) toolbar = { toolbar: false };
	if (profile === QuillEditorProfile.Description) {
		formats = [
			...formats,
			'strike',
			'code',
			'header',
			'list',
			'indent',
			'blockquote',
			'code-block',
			'link',
			'image',
		];
		const container = [
			[{ header: [1, 2, 3, false] }],
			['bold', 'italic', 'underline', 'strike', 'code'],
			[{ list: 'ordered' }, { list: 'bullet' }],
			['blockquote', 'code-block', 'link'],
			['clean'],
		];
		toolbar = { toolbar: container };
		if (showSource !== undefined)
			toolbar = {
				toolbar: { container: [...container, ['source']], handlers: { source: showSource } },
			};
	}
	const options: QuillOptions = {
		theme: 'snow',
		formats,
		modules: {
			...toolbar,
			keyboard: { bindings: TAB_LEAVES_FIELD },
			history: { userOnly: true },
		},
	};
	if (placeholder !== undefined) options.placeholder = placeholder;
	return options;
}
