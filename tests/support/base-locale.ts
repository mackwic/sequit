import { baseLocale, overwriteGetLocale } from '../../src/app/web/i18n/paraglide/runtime';

// Node and DOM test environments report an English navigator: tests read the base locale
// unless they choose another one.
overwriteGetLocale(() => baseLocale);
