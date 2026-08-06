import maxTopLevelFunctions from './max-top-level-functions.js';
import noAnonymousObjectUnionMembers from './no-anonymous-object-union-members.js';
import preferStringEnum from './prefer-string-enum.js';

export default {
	rules: {
		'max-top-level-functions': maxTopLevelFunctions,
		'no-anonymous-object-union-members': noAnonymousObjectUnionMembers,
		'prefer-string-enum': preferStringEnum,
	},
};
