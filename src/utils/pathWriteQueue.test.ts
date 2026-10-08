import { expect, it } from "vitest";
import { enqueuePathWrite } from "./pathWriteQueue";

it("serializes one destination and recovers after a failed write", async () => {
  let finish!: () => void;
  const order: number[] = [];
  const first = enqueuePathWrite("/song.lrc", async () => {
    order.push(1);
    await new Promise<void>((resolve) => { finish = resolve; });
    throw new Error("disk full");
  });
  const rejected = expect(first).rejects.toThrow("disk full");
  const second = enqueuePathWrite("/song.lrc", async () => { order.push(2); return "saved"; });
  const other = enqueuePathWrite("/other.lrc", async () => { order.push(3); });
  await other;
  expect(order).toEqual([1, 3]);
  finish();
  await rejected;
  expect(await second).toBe("saved");
  expect(order).toEqual([1, 3, 2]);
});
