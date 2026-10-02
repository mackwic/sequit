import { compile } from '@inlang/paraglide-js';

import { paraglideOptions } from '../config/paraglide.ts';

// Type checks, lint and tests read the generated messages without running Vite.
await compile(paraglideOptions);
