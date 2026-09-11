import { beforeEach, describe, expect, it, vi } from 'vitest';

const file = vi.hoisted(() => ({ current: '', temporary: '' }));
vi.mock('node:fs/promises', () => ({
	readFile: vi.fn(() => Promise.resolve(file.current)),
	writeFile: vi.fn((_path: string, content: string) => {
		file.temporary = content;
		return Promise.resolve();
	}),
	rename: vi.fn(() => {
		file.current = file.temporary;
		return Promise.resolve();
	}),
}));
import { readDocument, saveDocument } from '../../../../src/app/workshop/glossary/storage';

const source = '| VL-101 | Point | Point | Position | todo | |';
beforeEach(() => {
	file.current = source;
	file.temporary = '';
});
describe('glossary local persistence', () => {
	it('saves and reads the document', async () => {
		await saveDocument(source, source.replace('Position', 'Updated position'));
		expect(await readDocument()).toContain('Updated position');
	});
	it('rejects stale writes and preserves the newer document', async () => {
		await saveDocument(source, `${source}\nNotes`);
		await expect(saveDocument(source, source)).rejects.toMatchObject({ status: 409 });
		expect(await readDocument()).toContain('Notes');
	});
	it('serializes simultaneous writes', async () => {
		const results = await Promise.allSettled([
			saveDocument(source, `${source}\nFirst`),
			saveDocument(source, `${source}\nSecond`),
		]);
		expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
	});

	it('persists additions and removals, rejects malformed documents', async () => {
		const addition = `${source}\n| VL-new | A | A | D | S | |`;
		await saveDocument(source, addition);
		expect(await readDocument()).toBe(addition);
		await saveDocument(addition, source);
		expect(await readDocument()).toBe(source);
		await expect(saveDocument(source, 'Broken')).rejects.toMatchObject({ status: 400 });
	});
});
