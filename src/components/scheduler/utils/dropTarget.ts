/**
 * The room/time grid cell (ResourceRow/WeekViewVertical cells carry
 * data-pending-drop-resource-id) under a drop point — via elementsFromPoint
 * (plural), since an existing event block or the availability overlay can
 * sit on top of the cell itself, and a plain elementFromPoint().closest()
 * then finds nothing and silently drops the drop. `within`, when given,
 * scopes the match to one grid (e.g. a modal's own, not the page behind it).
 */
export function findDropCellAt(clientX: number, clientY: number, within?: HTMLElement | null): HTMLElement | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (!(el instanceof HTMLElement)) continue;
    const cell = el.closest<HTMLElement>('[data-pending-drop-resource-id]');
    if (cell && (!within || within.contains(cell))) return cell;
  }
  return null;
}
