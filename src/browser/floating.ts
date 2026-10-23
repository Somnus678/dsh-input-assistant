export interface ViewportBounds { left: number; top: number; width: number; height: number }
export interface AnchorBounds { left: number; top: number; right: number; bottom: number; width: number }
export interface FloatingPlacement { left: number; top: number; width: number; maxHeight: number }

/** Keep the entire scrollable surface in the visible viewport, independent of composer clipping. */
export function placeFloating(anchor: AnchorBounds, contentHeight: number, viewport: ViewportBounds, preferredWidth = 440): FloatingPlacement {
  const margin = 12, gap = 8
  const width = Math.max(1, Math.min(preferredWidth, viewport.width - margin * 2))
  const left = Math.max(viewport.left + margin, Math.min(anchor.right - width, viewport.left + viewport.width - margin - width))
  const above = Math.max(0, anchor.top - viewport.top - margin - gap)
  const below = Math.max(0, viewport.top + viewport.height - margin - anchor.bottom - gap)
  const maximum = Math.max(1, Math.min(560, viewport.height - margin * 2))
  const useAbove = above >= Math.min(contentHeight, maximum) || above >= below
  const room = useAbove ? above : below
  // Tiny or heavily zoomed windows get a viewport-contained panel rather than an inaccessible sliver.
  if (room < Math.min(120, maximum)) return { left, top: viewport.top + margin, width, maxHeight: maximum }
  const maxHeight = Math.min(maximum, room)
  const height = Math.min(Math.max(1, contentHeight), maxHeight)
  const top = useAbove ? anchor.top - gap - height : anchor.bottom + gap
  return { left, top: Math.max(viewport.top + margin, top), width, maxHeight }
}
