import type { Context } from '@deepseek-ai/cordis';
export declare const name = "input-assistant.client";
export declare const inject: string[];
/** Slot registration stays inside the mounted fiber; unloading owns all timers and DOM. */
export declare function apply(ctx: Context): void;
export { BrowserRuntime, InputAssistantController } from './public.js';
