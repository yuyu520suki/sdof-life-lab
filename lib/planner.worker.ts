import { solveWithHighs } from "./highs-solver";
import type { PlannerInput } from "./planner";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ input: PlannerInput }>) => void) | null;
  postMessage: (message: unknown) => void;
};
scope.onmessage = async (event) => {
  try { scope.postMessage({ result: await solveWithHighs(event.data.input) }); }
  catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : "排程失败" }); }
};
