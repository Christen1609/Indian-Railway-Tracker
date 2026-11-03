// Features: the retention command

import { readConfig } from '../config.js';
import { sweepJourneys } from './sweep.js';

await sweepJourneys(readConfig(process.env), new Date().toISOString()); // the sweep, from sweepJourneys
