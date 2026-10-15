"use client";

import type { PlanResult } from "./domain";
import PlannerWorker from "./planner.worker?worker";
import { buildRulePlan, preparePlannerInput, validatePlan, type PlannerInput } from "./planner";

function fallback(input: PlannerInput, code: string, message: string): PlanResult {
  const result = buildRulePlan(input);
  result.issues.push({ code, message });
  return result;
}

/** Each request owns a Worker. A stalled/terminated solve never gets misreported as infeasible. */
export function generatePlan(input: PlannerInput): Promise<PlanResult> {
  if (typeof Worker === "undefined") return Promise.resolve(fallback(input, "worker_unavailable", "此环境无法启动后台优化，已生成经过校验的规则草案。"));
  return new Promise((resolve) => {
    let worker: Worker;
    // Vinext rewrites import.meta.url during RSC transforms. Vite's factory
    // preserves a same-origin HTTP asset URL in both dev and production.
    try { worker = new PlannerWorker({ name: "sdof-planner" }); }
    catch (error) {
      console.error("Planner worker initialization failed", error);
      resolve(fallback(input, "worker_initialization_failed", "后台优化未能启动，已生成经过校验的规则草案。")); return;
    }
    let settled = false;
    const finish = (result: PlanResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish(fallback(input, "worker_timeout", "后台优化超过十秒，已停止并返回规则草案；超时不表示日程不可安排。")), 10_000);
    worker.onmessage = (event: MessageEvent<{ result?: PlanResult; error?: string }>) => {
      if (!event.data.result) { finish(fallback(input, "worker_error", "后台优化失败，已返回规则草案。")); return; }
      const result = event.data.result;
      const issues = validatePlan(input, result);
      // Missing data remains explicitly needs_input; reject any newly introduced hard violation.
      const inputIssues = preparePlannerInput(input).issues;
      const unexpected = issues.filter((issue) => !inputIssues.some((known) => known.code === issue.code && known.date === issue.date));
      finish(unexpected.length ? fallback(input, "worker_validation_failed", "后台结果未通过独立校验，已返回规则草案。") : result);
    };
    worker.onerror = () => finish(fallback(input, "worker_error", "后台优化加载或运行失败，已返回规则草案。"));
    worker.onmessageerror = () => finish(fallback(input, "worker_message_error", "后台结果无法读取，已返回规则草案。"));
    worker.postMessage({ input });
  });
}
