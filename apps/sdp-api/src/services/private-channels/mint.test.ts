import { findAllowedMintPda, PRIVATE_CHANNEL_ESCROW_PROGRAM_ADDRESS } from "@sdp/spc-escrow";
import { privateChannelTokens } from "@sdp/types";
import { address } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { readPrivateChannelTokenEligibility, resolveChannelToken } from "./mint";
import type { PrivateChannelProjectRpcClient } from "./project-rpc";

const TOKEN = privateChannelTokens("devnet")[0];
if (!TOKEN) throw new Error("Expected a registered devnet token");
const [, BUMP] = await findAllowedMintPda({
  instance: address("11111111111111111111111111111111"),
  mint: address(TOKEN.mint),
});
const VALID_DATA = Buffer.from([2, BUMP]).toString("base64");

const INSTANCE = {
  escrowProgramId: PRIVATE_CHANNEL_ESCROW_PROGRAM_ADDRESS,
  escrowInstanceAddr: address("11111111111111111111111111111111"),
};

function projectRpc(
  getAccountInfo: () => {
    send: () => Promise<{ value: { owner: string; data: [string, "base64"] } | null }>;
  }
): PrivateChannelProjectRpcClient {
  return {
    cluster: "devnet",
    rpc: { getAccountInfo } as never,
    target: {} as never,
    probe: vi.fn(),
  };
}

describe("Private Channels token eligibility", () => {
  it("enables a registered token when its allowedMint account belongs to the escrow program", async () => {
    const rpc = projectRpc(() => ({
      send: async () => ({
        value: { owner: PRIVATE_CHANNEL_ESCROW_PROGRAM_ADDRESS, data: [VALID_DATA, "base64"] },
      }),
    }));

    const [token] = await readPrivateChannelTokenEligibility(INSTANCE, rpc);

    expect(token).toMatchObject({
      mint: privateChannelTokens("devnet")[0]?.mint,
      enabled: true,
      exclusionReasons: [],
    });
    await expect(resolveChannelToken(INSTANCE, rpc, token?.mint)).resolves.toMatchObject({
      mint: token?.mint,
    });
  });

  it.each([
    ["empty", []],
    ["truncated", [2]],
    ["wrong discriminator", [1, BUMP]],
    ["wrong bump", [2, (BUMP + 1) % 256]],
    ["unsupported layout", [2, BUMP, 0]],
  ])("rejects %s allowedMint data for explicit and default writes", async (_name, bytes) => {
    const rpc = projectRpc(() => ({
      send: async () => ({
        value: {
          owner: PRIVATE_CHANNEL_ESCROW_PROGRAM_ADDRESS,
          data: [Buffer.from(bytes).toString("base64"), "base64"],
        },
      }),
    }));
    const [token] = await readPrivateChannelTokenEligibility(INSTANCE, rpc);
    expect(token).toMatchObject({
      enabled: false,
      exclusionReasons: [{ code: "NOT_ALLOWED_BY_INSTANCE" }],
    });
    for (const mint of [TOKEN.mint, undefined]) {
      await expect(resolveChannelToken(INSTANCE, rpc, mint)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
  });

  it("does not accept valid account bytes owned by a different program", async () => {
    const getAccountInfo = vi.fn(() => ({
      send: async () => ({
        value: {
          owner: "11111111111111111111111111111111",
          data: [VALID_DATA, "base64"] as [string, "base64"],
        },
      }),
    }));
    const [token] = await readPrivateChannelTokenEligibility(INSTANCE, projectRpc(getAccountInfo));
    expect(token?.enabled).toBe(false);
    expect(getAccountInfo).toHaveBeenCalledWith(expect.any(String), { encoding: "base64" });
  });

  it("marks a missing allowedMint account as disabled and rejects it for writes", async () => {
    const rpc = projectRpc(() => ({ send: async () => ({ value: null }) }));
    const [token] = await readPrivateChannelTokenEligibility(INSTANCE, rpc);

    expect(token).toMatchObject({
      enabled: false,
      exclusionReasons: [{ code: "NOT_ALLOWED_BY_INSTANCE" }],
    });
    await expect(resolveChannelToken(INSTANCE, rpc, token?.mint)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("reports an unavailable allowlist and fails writes closed", async () => {
    const rpc = projectRpc(() => ({
      send: async () => {
        throw new Error("RPC unavailable");
      },
    }));
    const [token] = await readPrivateChannelTokenEligibility(INSTANCE, rpc);

    expect(token).toMatchObject({
      enabled: false,
      exclusionReasons: [{ code: "ALLOWLIST_UNAVAILABLE" }],
    });
    await expect(resolveChannelToken(INSTANCE, rpc, token?.mint)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
