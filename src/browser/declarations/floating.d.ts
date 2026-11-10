export interface ViewportBounds {
    left: number;
    top: number;
    width: number;
    height: number;
}
export interface AnchorBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
}
export interface FloatingPlacement {
    left: number;
    top: number;
    width: number;
    maxHeight: number;
}
/** Keep the entire scrollable surface in the visible viewport, independent of composer clipping. */
export declare function placeFloating(anchor: AnchorBounds, contentHeight: number, viewport: ViewportBounds, preferredWidth?: number): FloatingPlacement;
