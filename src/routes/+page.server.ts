import { blankDocument } from '../lib/infrastructure/document/document-creation';
import { serializeSequitToml } from '../lib/infrastructure/toml/serialize-sequit-toml';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	source: serializeSequitToml(blankDocument(`document-${crypto.randomUUID()}`)),
});
