import { currentClusterScope } from "@sdp/rpc/scope";
import { SDP_ENVIRONMENTS, type SdpEnvironment } from "@sdp/types/api-keys";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackgroundRunner } from "@/runtime/background";
import { noopObservability } from "@/runtime/observability";
import * as collectRecurringPaymentsModule from "@/services/jobs/collect-recurring-payments";
import type { Env } from "@/types/env";
import { runRecurringPaymentsCollection } from "./recurring-payments";

const env: Env = { ENVIRONMENT: "development", API_VERSION: "v1" };

describe("runRecurringPaymentsCollection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collects once inside each environment's cluster scope", async () => {
    const scopedEnvironments: SdpEnvironment[] = [];
    vi.spyOn(collectRecurringPaymentsModule, "collectDueRecurringPayments").mockImplementation(
      async () => {
        scopedEnvironments.push(currentClusterScope().environment);
        return { recovered: 0, collected: 0, failed: 0, skipped: 0, refused: 0 };
      }
    );
    const runs: Promise<unknown>[] = [];
    const bg: BackgroundRunner = {
      run: (promise) => {
        runs.push(promise);
      },
      awaitAll: async () => {},
      draining: false,
    };

    runRecurringPaymentsCollection({ env, bg });
    await Promise.all(runs);

    expect(runs).toHaveLength(1);
    expect(scopedEnvironments).toHaveLength(SDP_ENVIRONMENTS.length);
    expect(new Set(scopedEnvironments)).toEqual(new Set(SDP_ENVIRONMENTS));
  });

  it.each([false, true])("reports row failures with observability=%s", async (monitored) => {
    const collect = vi
      .spyOn(collectRecurringPaymentsModule, "collectDueRecurringPayments")
      .mockResolvedValue({ recovered: 0, collected: 1, failed: 0, skipped: 0, refused: 0 })
      .mockResolvedValueOnce({ recovered: 0, collected: 0, failed: 1, skipped: 0, refused: 0 });
    const runs: Promise<unknown>[] = [];
    const bg: BackgroundRunner = {
      run: (promise) => runs.push(promise),
      awaitAll: async () => {},
      draining: false,
    };

    runRecurringPaymentsCollection({
      env,
      bg,
      observability: monitored ? noopObservability : undefined,
    });

    await expect(Promise.all(runs)).rejects.toThrow(
      "Recurring payment collection failed for 1 rows"
    );
    expect(collect).toHaveBeenCalledTimes(SDP_ENVIRONMENTS.length);
  });
});
