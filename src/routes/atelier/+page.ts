import type { PageLoad } from './$types';
import { loadWorkshopFixture } from './runtime/workshop-fixture';

export const load: PageLoad = ({ url }) => ({ fixture: loadWorkshopFixture(url.searchParams) });
