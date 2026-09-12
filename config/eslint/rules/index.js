import allowedImportDirections from './allowed-import-directions.js';
import forwardVisualLayoutConfiguration from './forward-visual-layout-configuration.js';
import maxBodyNesting from './max-body-nesting.js';
import maxOperatorsPerExpression from './max-operators-per-expression.js';
import maxTopLevelFunctions from './max-top-level-functions.js';
import noAbandonedVisualSelection from './no-abandoned-visual-selection.js';
import noAnonymousObjectUnionMembers from './no-anonymous-object-union-members.js';
import noSwallowedVisualAssertion from './no-swallowed-visual-assertion.js';
import noUncontrolledVisualInput from './no-uncontrolled-visual-input.js';
import preferNativeStringEnum from './prefer-native-string-enum.js';
import preferStringEnum from './prefer-string-enum.js';
import requireVisualAssertion from './require-visual-assertion.js';
import visualScenarioPhases from './visual-scenario-phases.js';

export default {
	rules: {
		'no-uncontrolled-visual-input': noUncontrolledVisualInput,
		'forward-visual-layout-configuration': forwardVisualLayoutConfiguration,
		'visual-scenario-phases': visualScenarioPhases,
		'require-visual-assertion': requireVisualAssertion,
		'no-abandoned-visual-selection': noAbandonedVisualSelection,
		'no-swallowed-visual-assertion': noSwallowedVisualAssertion,
		'allowed-import-directions': allowedImportDirections,
		'max-body-nesting': maxBodyNesting,
		'max-operators-per-expression': maxOperatorsPerExpression,
		'max-top-level-functions': maxTopLevelFunctions,
		'no-anonymous-object-union-members': noAnonymousObjectUnionMembers,
		'prefer-native-string-enum': preferNativeStringEnum,
		'prefer-string-enum': preferStringEnum,
	},
};
