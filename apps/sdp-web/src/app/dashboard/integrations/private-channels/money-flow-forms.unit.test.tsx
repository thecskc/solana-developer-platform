// @vitest-environment jsdom

import type { CustodyWalletSummary, PrivateChannelTokenEligibility } from "@sdp/types";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ balances: vi.fn(), submit: vi.fn(), recipients: vi.fn() }));
vi.mock("./wallet-balances", () => ({ fetchWalletBalancesAction: mocks.balances }));
vi.mock("./deposit/actions", () => ({ createDepositAction: mocks.submit }));
vi.mock("./withdraw/actions", () => ({ createWithdrawalAction: mocks.submit }));
vi.mock("./transfer/actions", () => ({
  createTransferAction: mocks.submit,
  fetchTransferRecipientsAction: mocks.recipients,
}));
vi.mock("./deposit/deposit-progress", () => ({ DepositProgress: () => null }));
vi.mock("./withdraw/withdraw-progress", () => ({ WithdrawProgress: () => null }));
vi.mock("./transfer/transfer-progress", () => ({ TransferProgress: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    iconLeft: _iconLeft,
    ...props
  }: ComponentProps<"button"> & { iconLeft?: ReactNode }) => <button {...props} />,
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("@/components/ui/label", () => ({
  // biome-ignore lint/a11y/noLabelWithoutControl: forwards the component's association.
  Label: (props: ComponentProps<"label">) => <label {...props} />,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    ariaLabel,
    onValueChange,
    value,
    disabled,
  }: {
    children: ReactNode;
    ariaLabel?: string;
    onValueChange: (value: string) => void;
    value: string;
    disabled?: boolean;
  }) => (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="">Select</option>
      {children}
    </select>
  ),
  SelectItem: (props: ComponentProps<"option">) => <option {...props} />,
}));

import { getMessages } from "@/i18n/messages";
import { I18nProvider } from "@/i18n/provider";
import { DepositForm } from "./deposit/deposit-form";
import { TransferForm } from "./transfer/transfer-form";
import type { WalletBalanceView } from "./wallet-balances";
import { WithdrawForm } from "./withdraw/withdraw-form";

const tokenA: PrivateChannelTokenEligibility = {
  mint: "mint_a",
  symbol: "TKNA",
  decimals: 6,
  tokenProgram: "token",
  enabled: true,
  exclusionReasons: [],
};
const tokenB = { ...tokenA, mint: "mint_b", symbol: "TKNB" };
const wallets: CustodyWalletSummary[] = [
  {
    id: "custody",
    custodyConfigId: "config",
    walletId: "wallet",
    publicKey: "Sender11111111",
    label: "Treasury",
    purpose: null,
    status: "active",
    createdAt: "2026-07-28T00:00:00Z",
    isRuntimeExecutionAllowed: true,
  },
];
const channels = [{ id: "channel", name: "Channel", isDefault: true }];
function wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" messages={getMessages("en")}>
      {children}
    </I18nProvider>
  );
}
function deferred() {
  let resolve!: (value: WalletBalanceView) => void;
  const promise = new Promise<WalletBalanceView>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
function form(flow: string, tokens: PrivateChannelTokenEligibility[]) {
  if (flow === "transfer")
    return (
      <TransferForm channels={channels} scopeKey="scope" sourceWallets={wallets} tokens={tokens} />
    );
  if (flow === "withdraw") return <WithdrawForm wallets={wallets} tokens={tokens} />;
  return <DepositForm wallets={wallets} tokens={tokens} />;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.recipients.mockResolvedValue({
    ok: true,
    recipients: [{ id: "recipient", pubkey: "Other111111", walletName: "Recipient" }],
  });
  mocks.submit.mockResolvedValue({ ok: false, kind: "server", message: "Try again" });
});
afterEach(cleanup);

describe.each(["transfer", "withdraw", "deposit"])("%s token eligibility refresh", (flow) => {
  it.each([false, true])(
    "keeps balances, selection, and submission on the effective mint (old response pending: %s)",
    async (pending) => {
      const oldBalance = deferred();
      const newBalance = deferred();
      mocks.balances
        .mockReturnValueOnce(oldBalance.promise)
        .mockReturnValueOnce(newBalance.promise);
      const view = render(form(flow, [tokenA, tokenB]), { wrapper });
      await waitFor(() => expect(mocks.balances).toHaveBeenCalledWith("wallet", "mint_a"));
      if (!pending) {
        await act(async () => oldBalance.resolve({ channel: "10", onChain: "5" }));
        expect(screen.getByText("10 TKNA")).toBeTruthy();
      }

      view.rerender(form(flow, [tokenB]));
      expect(screen.getByLabelText("Amount (TKNB)")).toBeTruthy();
      expect((screen.getByLabelText("Token") as HTMLSelectElement).value).toBe("mint_b");
      expect(screen.queryByText("10 TKNA")).toBeNull();
      await waitFor(() => expect(mocks.balances).toHaveBeenCalledWith("wallet", "mint_b"));
      if (pending) {
        await act(async () => oldBalance.resolve({ channel: "10", onChain: "5" }));
        expect(screen.queryByText("10 TKNB")).toBeNull();
      }
      await act(async () => newBalance.resolve({ channel: "20", onChain: "8" }));
      expect(screen.getByText("20 TKNB")).toBeTruthy();
      expect(screen.getByText("8 TKNB")).toBeTruthy();
      if (flow === "transfer") {
        await screen.findByRole("option", { name: /Recipient/ });
        fireEvent.change(screen.getByLabelText("Recipient wallet"), {
          target: { value: "recipient" },
        });
      }
      fireEvent.change(screen.getByLabelText("Amount (TKNB)"), { target: { value: "1" } });
      const element = screen.getByLabelText("Amount (TKNB)").closest("form");
      if (!element) throw new Error("Expected the money-flow form");
      fireEvent.submit(element);
      await waitFor(() =>
        expect(mocks.submit).toHaveBeenCalledWith(
          expect.objectContaining({ mint: "mint_b", amount: "1" })
        )
      );
    }
  );

  it("clears balances and avoids a default-mint request when no token remains", async () => {
    const response = deferred();
    mocks.balances.mockReturnValue(response.promise);
    const view = render(form(flow, [tokenA]), { wrapper });
    await waitFor(() => expect(mocks.balances).toHaveBeenCalledTimes(1));
    view.rerender(form(flow, []));
    await act(async () => response.resolve({ channel: "10", onChain: "5" }));
    expect(screen.queryByText("10 TKNA")).toBeNull();
    expect(screen.queryByText("10 USDC")).toBeNull();
    expect(mocks.balances).toHaveBeenCalledTimes(1);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
