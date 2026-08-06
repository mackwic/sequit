import maxOperatorsPerExpression from './max-operators-per-expression.js';
import maxTopLevelFunctions from './max-top-level-functions.js';
import noAnonymousObjectUnionMembers from './no-anonymous-object-union-members.js';
import preferStringEnum from './prefer-string-enum.js';

export default {
	rules: {
		'max-operators-per-expression': maxOperatorsPerExpression,
		'max-top-level-functions': maxTopLevelFunctions,
		'no-anonymous-object-union-members': noAnonymousObjectUnionMembers,
		'prefer-string-enum': preferStringEnum,
	},
};
