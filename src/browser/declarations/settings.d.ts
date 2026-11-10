import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { BrowserRuntime } from './runtime.js';
type SettingsProps = PropsRuntime<'settings.section'> & {
    runtime: BrowserRuntime;
};
/** A root-scoped DSH settings section; works even when no composer is mounted. */
export declare function AssistantSettings({ runtime }: SettingsProps): import("react").JSX.Element;
export {};
