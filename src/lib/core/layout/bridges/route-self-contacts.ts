import { defined } from '../../document/logic-document';
import type { LayoutRelation } from '../layout-types';
import { runContact } from './bridge-contact';
import { routeRuns } from './route-runs';

/** Detect a path that doubles back into a nonadjacent run of itself. */
export function validateSelfContacts(route: LayoutRelation): boolean {
	const runs = routeRuns(route);
	for (let first = 0; first < runs.length; first += 1) {
		for (let second = first + 2; second < runs.length; second += 1) {
			if (runContact(defined(runs[first]), defined(runs[second])) !== undefined) return false;
		}
	}
	return true;
}
