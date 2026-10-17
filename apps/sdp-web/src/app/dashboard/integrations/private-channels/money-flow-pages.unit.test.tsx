import type { PrivateChannelTokenEligibility } from "@sdp/types";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ eligibility: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("./private-channels-access", () => ({ requirePrivateChannelsAccess: vi.fn() }));
vi.mock("@/lib/sdp-api", () => ({
  createSdpApiClient: async () => ({}),
  extractSdpApiErrorMessage: (error: Error) => error.message,
  SdpApiResponseError: class extends Error {},
}));
vi.mock("@/lib/private-channels", () => ({
  fetchPrivateChannelInstance: async () => ({ instance: { id: "instance", isActive: true } }),
  fetchPrivateChannelTokenEligibility: mocks.eligibility,
  fetchVerifiedSignableWallets: async () => [],
  fetchPrivateChannelPrincipals: async () => [],
  fetchPrivateChannels: async () => [],
  fetchSignableCustodyWallets: async () => [],
  fetchVerifiedWallets: async () => [],
}));
vi.mock("./private-channels-load-error", () => ({
  PrivateChannelsLoadError: ({ message }: { message: string }) => <p role="alert">{message}</p>,
}));
vi.mock("./deposit/deposit-form", () => ({ DepositForm: Form }));
vi.mock("./withdraw/withdraw-form", () => ({ WithdrawForm: Form }));
vi.mock("./transfer/transfer-form", () => ({ TransferForm: Form }));
function Form({ tokens }: { tokens: PrivateChannelTokenEligibility[] }) {
  return <div data-testid="form">{tokens.map((token) => token.symbol).join(",")}</div>;
}

import DepositPage from "./deposit/page";
import TransferPage from "./transfer/page";
import WithdrawPage from "./withdraw/page";

const enabled: PrivateChannelTokenEligibility = {
  mint: "mint",
  symbol: "TKNA",
  decimals: 6,
  tokenProgram: "token",
  enabled: true,
  exclusionReasons: [],
};
const unavailable = {
  ...enabled,
  enabled: false,
  exclusionReasons: [
    {
      code: "ALLOWLIST_UNAVAILABLE" as const,
      message: "We could not check whether TKNA is enabled.",
    },
  ],
};
const disabled = {
  ...enabled,
  enabled: false,
  exclusionReasons: [
    {
      code: "NOT_ALLOWED_BY_INSTANCE" as const,
      message: "TKNA is not enabled.",
    },
  ],
};

beforeEach(() => vi.resetAllMocks());
describe.each([DepositPage, TransferPage, WithdrawPage])("%s eligibility states", (Page) => {
  it("shows the outage reason when a successful API response has no readable eligibility", async () => {
    mocks.eligibility.mockResolvedValue([unavailable, disabled]);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain(unavailable.exclusionReasons[0]?.message);
    expect(html).not.toContain('data-testid="form"');
  });
  it("keeps healthy tokens available during a partial outage", async () => {
    mocks.eligibility.mockResolvedValue([unavailable, enabled]);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('data-testid="form">TKNA');
    expect(html).not.toContain('role="alert"');
  });
  it("preserves the confirmed no-enabled-token form state", async () => {
    mocks.eligibility.mockResolvedValue([disabled]);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('data-testid="form"></div>');
    expect(html).not.toContain('role="alert"');
  });
  it("shows a failed eligibility request as a load error", async () => {
    mocks.eligibility.mockRejectedValue(new Error("RPC unavailable"));
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("RPC unavailable");
    expect(html).not.toContain('data-testid="form"');
  });
});
