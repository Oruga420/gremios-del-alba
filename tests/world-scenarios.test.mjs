import test from 'node:test';
import { scenarios } from './world-scenarios.mjs';
for(const [id,run]of Object.entries(scenarios))test(id,run);
