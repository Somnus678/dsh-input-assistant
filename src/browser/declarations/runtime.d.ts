import { InputAssistantController, type BrowserTransport } from './controller.js';
import type { AssistantConfig } from '../core/types.js';
export interface ConnectionFace {
    rpc: {
        call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{
            ok: true;
            value: unknown;
        } | {
            ok: false;
            error: {
                code?: string;
                message?: string;
            };
        }>;
    };
    generation: {
        getSnapshot(): {
            id: number;
        } | undefined;
        subscribe(listener: () => void): () => void;
    };
}
export interface ModelDirectoryFace {
    directoryFor(sessionId: string): {
        store: {
            getSnapshot(): {
                current: {
                    provider: string;
                    model: string;
                } | null;
            };
            subscribe(listener: () => void): () => void;
        };
        load(): Promise<unknown>;
    };
}
export declare class BrowserRuntime {
    readonly connection: ConnectionFace;
    readonly models?: ModelDirectoryFace | undefined;
    private entries;
    private disposed;
    private lifetime;
    private pendingSettings;
    private settingsQueue;
    private metrics;
    readonly transport: BrowserTransport;
    constructor(connection: ConnectionFace, models?: ModelDirectoryFace | undefined);
    controllerFor(sessionId: string): InputAssistantController;
    retain(sessionId: string): () => void;
    applySettings(settings: AssistantConfig): void;
    saveSettings(update: Partial<AssistantConfig>): Promise<AssistantConfig>;
    dispose(): void;
}
