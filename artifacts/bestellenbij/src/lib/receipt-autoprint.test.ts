import assert from "node:assert/strict";
import test from "node:test";
import { requestReceiptAutoPrint } from "./receipt-autoprint";

test("does not print until both order and restaurant receipt data are ready", () => {
  const frames: FrameRequestCallback[] = [];
  let printCalls = 0;
  const scheduleFrame = (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  };

  const whileRestaurantIsLoading = requestReceiptAutoPrint({
    printRequested: true,
    receiptReady: false,
    scheduleFrame,
    onPrint: () => {
      printCalls += 1;
    },
  });

  assert.equal(whileRestaurantIsLoading, null);
  assert.equal(frames.length, 0);
  assert.equal(printCalls, 0);

  const onceReceiptIsComplete = requestReceiptAutoPrint({
    printRequested: true,
    receiptReady: true,
    scheduleFrame,
    onPrint: () => {
      printCalls += 1;
    },
  });

  assert.equal(onceReceiptIsComplete, 1);
  assert.equal(printCalls, 0);
  frames[0]!(0);
  assert.equal(printCalls, 1);
});