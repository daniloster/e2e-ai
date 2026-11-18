// Registers the brand generator's resolve hook (loaded with --import by the launcher).
import { register } from 'node:module';

register('./ts-hooks.mjs', import.meta.url);
