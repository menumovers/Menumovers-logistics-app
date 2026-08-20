/**
 * Requests a browser print only when a complete receipt is ready to render.
 * Keeping this small decision outside the component makes the order/restaurant
 * loading race testable without a browser or print dialog.
 */
export function requestReceiptAutoPrint({
  printRequested,
  receiptReady,
  scheduleFrame,
  onPrint,
}: {
  printRequested: boolean;
  receiptReady: boolean;
  scheduleFrame: (callback: FrameRequestCallback) => number;
  onPrint: () => void;
}): number | null {
  if (!printRequested || !receiptReady) return null;
  return scheduleFrame(() => onPrint());
}