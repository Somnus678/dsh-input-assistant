import { type AssistantConfig, type AssistantStatus, type InputSnapshot, type ModelRoute, type StoredDraft, type TokenSpan } from '../core/types.js';
import { type ReferenceOccurrence } from './dom.js';
export interface BrowserInput {
    draft: string;
    draftRev: number;
    phase: string;
    attachmentIds: readonly unknown[];
    occurrences: readonly ReferenceOccurrence[];
}
export interface BrowserActions {
    captureInsertion(): TokenSpan;
    insertText(text: string, span: TokenSpan): boolean;
    persistDraft?(): void;
}
export interface BrowserBinding {
    sessionId: string;
    input: BrowserInput;
    actions: BrowserActions;
    editor: HTMLElement | null;
    running: boolean;
    route?: ModelRoute;
}
export interface BrowserTransport {
    call<T>(method: string, data: unknown, signal?: AbortSignal): Promise<T>;
    generation(): string | null;
}
export interface Suggestion {
    text: string;
    snapshot: InputSnapshot;
    kind: 'next' | 'complete';
}
export interface ChangeRecord {
    before: string;
    after: string;
    beforeTarget: string;
    afterTarget: string;
    span: TokenSpan;
    sourceTurnId: string | null;
    connectionGeneration: string;
    routeKey: string;
    clientGeneration: string | null;
}
export interface BrowserState {
    status: AssistantStatus | null;
    settings: AssistantConfig;
    busy: 'optimize' | 'stash' | null;
    notice: string;
    suggestion: Suggestion | null;
    change: ChangeRecord | null;
    drafts: readonly StoredDraft[];
    locked: readonly string[];
    connected: boolean;
    settingsSaving: boolean;
    metrics: UsageMetrics;
}
export interface UsageMetrics {
    exposures: number;
    accepted: number;
    editedAcceptances: number;
    editedCharacters: number;
    calls: number;
    totalLatencyMs: number;
}
/** One controller per mounted composer. Right/overlay surfaces consume this same store. */
export declare class InputAssistantController {
    readonly sessionId: string;
    private readonly transport;
    private readonly saveSettings?;
    private state;
    private listeners;
    private binding;
    private active;
    private timer;
    /** Cache key the armed completion timer was scheduled for; null when no timer is armed. */
    private timerKey;
    private poll;
    private polling;
    private lifecycle;
    private disposed;
    private composing;
    private settingsPending;
    private settingsEpoch;
    private nextTurns;
    private nextCache;
    private completionCache;
    private failedCompletionKey;
    private lastCompletionStart;
    private suppressUntilEdit;
    private sequence;
    private clientGeneration;
    private lockedRanges;
    private exposed;
    private acceptance;
    constructor(sessionId: string, transport: BrowserTransport, metrics?: UsageMetrics, saveSettings?: ((update: Partial<AssistantConfig>) => Promise<AssistantConfig>) | undefined);
    getSnapshot: () => BrowserState;
    subscribe: (listener: () => void) => (() => void);
    private patch;
    start(): void;
    dispose(): void;
    bind(binding: BrowserBinding): void;
    notifySelectionChange(): void;
    setComposing(value: boolean): void;
    dismissSuggestion(): void;
    cancelOperation(): void;
    clearNotice(): void;
    notice(text: string): void;
    refresh(): Promise<void>;
    updateSettings(update: Partial<AssistantConfig>): Promise<void>;
    beginSettingsUpdate(): void;
    endSettingsUpdate(): void;
    /** A settings page can update every mounted composer without waiting for its status poll. */
    applySettings(settings: AssistantConfig): void;
    lockSelection(): void;
    clearLocks(): void;
    optimize(): Promise<void>;
    canRestore(): boolean;
    restoreOriginal(): boolean;
    triggerSuggestion(): Promise<void>;
    acceptSuggestion(): boolean;
    /** Called only after the overlay has actually rendered a candidate. */
    markExposed(requestId: string): void;
    refreshDrafts(): Promise<void>;
    stash(replaceId?: string): Promise<void>;
    restoreDraft(draft: StoredDraft, mode: 'append' | 'replace'): boolean;
    deleteDraft(id: string): Promise<void>;
    clearDrafts(): Promise<void>;
    private mutateDraft;
    private captureTarget;
    private pureText;
    private eligible;
    private driveSuggestions;
    private requestSuggestion;
    private snapshot;
    private begin;
    private observeAcceptedEdit;
    private isCurrent;
    private validResult;
    private sameCaret;
    private routeKey;
    private completionKey;
    private invalidate;
    private clearTimer;
    private cancelActive;
    private recordLatency;
    private errorMessage;
}
