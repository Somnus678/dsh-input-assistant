import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { BrowserRuntime } from './runtime.js';
type RuntimeProps = {
    runtime: BrowserRuntime;
};
type RightProps = PropsRuntime<'conversation.input.right'> & RuntimeProps;
type OverlayProps = PropsRuntime<'conversation.input.overlay'> & RuntimeProps;
/** The right slot owns input observation; the overlay only paints the same controller's state. */
export declare function AssistantRight({ runtime, sessionId, useInput, useSession, inputActions }: RightProps): import("react").JSX.Element;
export declare function AssistantOverlay({ runtime, sessionId }: OverlayProps): import("react").JSX.Element;
export {};
