import type { BackgroundRunner } from "@/runtime/background";
import { runInEachClusterScope } from "@/runtime/cluster-scope-runs";
import type { Observability } from "@/runtime/observability";
import { collectDueRecurringPayments } from "@/services/jobs/collect-recurring-payments";
import type { Env } from "@/types/env";

export const RECURRING_PAYMENTS_COLLECTION_MONITOR = "sdp-api-collect-recurring-payments";
export const RECURRING_PAYMENTS_COLLECTION_CRON = "*/5 * * * *";

export interface RecurringPaymentsCollectionDeps {
  env: Env;
  bg: BackgroundRunner;
  observability?: Observability;
}

export function runRecurringPaymentsCollection(deps: RecurringPaymentsCollectionDeps): void {
  const work = () => runRecurringPaymentsCollectionTick(deps.env);
  const promise = deps.observability
    ? deps.observability.withMonitor(RECURRING_PAYMENTS_COLLECTION_MONITOR, work, {
        schedule: { type: "crontab", value: RECURRING_PAYMENTS_COLLECTION_CRON },
      })
    : Promise.resolve().then(work);

  deps.bg.run(promise);
}

export async function runRecurringPaymentsCollectionTick(env: Env): Promise<void> {
  await runInEachClusterScope(async () => {
    const result = await collectDueRecurringPayments(env, new Date());
    if (result.failed > 0) {
      throw new Error(`Recurring payment collection failed for ${result.failed} rows`);
    }
    if (result.awaitingRetry > 0) {
      throw new Error(
        `Recurring payment collection has ${result.awaitingRetry} due cycles awaiting retry`
      );
    }
  });
}
