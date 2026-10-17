"use client";

import { useEffect, useState } from "react";
import { fetchWalletBalancesAction, type WalletBalanceView } from "./wallet-balances";

const EMPTY_BALANCES: WalletBalanceView = { channel: null, onChain: null };

/** Only display a response belonging to the current wallet, effective mint, and refresh. */
export function useWalletBalances(walletId: string, mint: string | undefined, refetchKey: number) {
  const [result, setResult] = useState<{
    walletId: string;
    mint: string;
    refetchKey: number;
    balances: WalletBalanceView;
  } | null>(null);

  useEffect(() => {
    if (!walletId || !mint) return;
    let active = true;
    void fetchWalletBalancesAction(walletId, mint).then(
      (balances) => {
        if (active) setResult({ walletId, mint, refetchKey, balances });
      },
      () => {
        if (active) setResult({ walletId, mint, refetchKey, balances: EMPTY_BALANCES });
      }
    );
    return () => {
      active = false;
    };
  }, [walletId, mint, refetchKey]);

  return result?.walletId === walletId && result.mint === mint && result.refetchKey === refetchKey
    ? result.balances
    : EMPTY_BALANCES;
}
