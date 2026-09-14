import type { QuillOptions } from 'quill';

export enum QuillEditorProfile {
	Plain = 'plain',
	Body = 'body',
	Description = 'description',
}

/** The body stays compact; descriptions may use the editor's larger Markdown subset. */
export function quillEditorOptions(profile: QuillEditorProfile): QuillOptions {
	let formats = ['bold', 'italic', 'underline'];
	let toolbar: QuillOptions['modules'] = { toolbar: [['bold', 'italic', 'underline'], ['clean']] };
	if (profile === QuillEditorProfile.Plain) {
		formats = [];
		toolbar = { toolbar: false };
	}
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
		toolbar = {
			toolbar: [
				[{ header: [1, 2, 3, false] }],
				['bold', 'italic', 'underline', 'strike', 'code'],
				[{ list: 'ordered' }, { list: 'bullet' }],
				['blockquote', 'code-block', 'link'],
				['clean'],
			],
		};
	}
	return { theme: 'snow', formats, modules: { ...toolbar, history: { userOnly: true } } };
}
