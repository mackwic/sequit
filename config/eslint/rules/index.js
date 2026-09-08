import allowedImportDirections from './allowed-import-directions.js';
import maxBodyNesting from './max-body-nesting.js';
import maxOperatorsPerExpression from './max-operators-per-expression.js';
import maxTopLevelFunctions from './max-top-level-functions.js';
import noAnonymousObjectUnionMembers from './no-anonymous-object-union-members.js';
import preferNativeStringEnum from './prefer-native-string-enum.js';
import preferStringEnum from './prefer-string-enum.js';

export default {
	rules: {
		'allowed-import-directions': allowedImportDirections,
		'max-body-nesting': maxBodyNesting,
		'max-operators-per-expression': maxOperatorsPerExpression,
		'max-top-level-functions': maxTopLevelFunctions,
		'no-anonymous-object-union-members': noAnonymousObjectUnionMembers,
		'prefer-native-string-enum': preferNativeStringEnum,
		'prefer-string-enum': preferStringEnum,
	},
};
