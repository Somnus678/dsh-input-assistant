import type { TokenSpan } from '../core/types.js';
export interface ReferenceOccurrence {
    offset: number;
    length: number;
}
export declare const CHIP_SELECTOR = "[data-composer-chip],[data-composer-text-ref],[data-composer-command]";
export declare function findEditor(anchor: HTMLElement | null): HTMLElement | null;
export declare function focusedIn(editor: HTMLElement | null): boolean;
export declare function referenceOverlaps(span: TokenSpan, references: readonly ReferenceOccurrence[]): boolean;
/** Public InputState references use clipboard offsets; TokenSpan uses one character per reference. */
export declare function clipboardOffset(detectOffset: number, references: readonly ReferenceOccurrence[]): number;
export declare function selectedPlainText(editor: HTMLElement | null, draft: string, span: TokenSpan, references: readonly ReferenceOccurrence[]): {
    text: string;
    clipboardStart: number;
    clipboardEnd: number;
} | null;
export interface GhostGeometry {
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    font: string;
    lineHeight: string;
    letterSpacing: string;
}
/** Read-only DOM measurements; failure hides the decoration instead of guessing padding. */
export declare function measureGhost(editor: HTMLElement | null, empty: boolean): GhostGeometry | null;
export declare function nativeMenuOpen(editor: HTMLElement | null): boolean;
export declare function canUseTab(event: KeyboardEvent, editor: HTMLElement | null, composing: boolean): boolean;
