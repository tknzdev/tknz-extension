import { Connection } from '@solana/web3.js';
import { logEventToFirestore } from '../firebase';

/**
 * RPC endpoint for Solana network.
 */
const PROD_RPC_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=5e4edb76-36ed-4740-942d-7843adcc1e22';
const DEVNET_RPC_ENDPOINT = 'https://devnet.helius-rpc.com/?api-key=5e4edb76-36ed-4740-942d-7843adcc1e22';
// Allow overriding RPC endpoint via env var VITE_RPC_URL, else fallback to ENV-based default
const ENV_RPC_URL = (import.meta.env as Record<string, string>).VITE_RPC_URL;
const RPC_ENDPOINT = ENV_RPC_URL
  ? ENV_RPC_URL
  : (import.meta.env.VITE_ENV === 'prod' ? PROD_RPC_ENDPOINT : DEVNET_RPC_ENDPOINT);

/**
 * High-level Solana connection for sending and confirming transactions.
 */
export const web3Connection = new Connection(RPC_ENDPOINT, 'confirmed');

/**
 * Lightweight RPC client for balance and token balance checks.
 */
export const createConnection = () => {
  /**
   * Fetch SOL balance for a given public key via RPC.
   */
  const getBalance = async (publicKey: string): Promise<number> => {
    const body = {
      jsonrpc: '2.0',
      id: 'bolt',
      method: 'getBalance',
      params: [publicKey, { commitment: 'confirmed' }]
    };
    try {
      const response = await window.fetch(RPC_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || 'RPC error');
      }
      const balance = data.result?.value ?? 0;
      logEventToFirestore('balance_update', { walletAddress: publicKey, balance });
      return balance;
    } catch (error) {
      // Suppress error logs during testing
      if (!(import.meta as any).vitest) {
        console.error('Failed to fetch balance:', error);
      }
      throw error;
    }
  };

  /**
   * Fetch SPL token balance for a given token and owner via RPC.
   */
  const getTokenBalance = async (tokenAddress: string, ownerAddress: string): Promise<number> => {
    const body = {
      jsonrpc: '2.0',
      id: 'bolt',
      method: 'getTokenAccountsByOwner',
      params: [ownerAddress, { mint: tokenAddress }, { encoding: 'jsonParsed' }]
    };
    try {
      const response = await fetch(RPC_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || 'RPC error');
      }
      const accounts = data.result?.value || [];
      if (accounts.length === 0) return 0;
      const balance = accounts[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
      logEventToFirestore('token_balance_update', { walletAddress: ownerAddress, tokenAddress, balance });
      return balance;
    } catch (error) {
      // Suppress error logs during testing
      if (!(import.meta as any).vitest) {
        console.error('Failed to fetch token balance:', error);
      }
      return 0;
    }
  };

  /**
   * Fetch *all* SPL token accounts for the wallet in one RPC call (JSON parsed).
   * Mirrors the @solana/web3.js `getParsedTokenAccountsByOwner` helper that is
   * used throughout the codebase. Only the subset of behaviour required by the
   * extension is implemented – enough for store.ts where we iterate over the
   * returned `value` array.
   */
  const getParsedTokenAccountsByOwner = async (
    ownerAddress: string | { toString(): string },
    filter: { mint?: string; programId?: string | { toString(): string } },
    commitmentOrConfig: string | Record<string, unknown> = 'confirmed',
  ): Promise<{ value: any[] }> => {
    // Build RPC params – they follow the same order as the web3.js helper:
    // 1. owner public key, 2. filter, 3. config object
    const owner = typeof ownerAddress === 'string' ? ownerAddress : ownerAddress.toString();

    const commitment =
      typeof commitmentOrConfig === 'string'
        ? { commitment: commitmentOrConfig }
        : commitmentOrConfig || {};

    const config = { encoding: 'jsonParsed', ...commitment };

    // Serialize filter object: support `programId` (PublicKey or string) or `mint`.
    const rpcFilter: Record<string, string> = {};
    if (filter?.programId) {
      rpcFilter.programId =
        typeof filter.programId === 'string' ? filter.programId : filter.programId.toString();
    }
    if (filter?.mint) {
      rpcFilter.mint = filter.mint;
    }

    const body = {
      jsonrpc: '2.0',
      id: 'bolt',
      method: 'getTokenAccountsByOwner',
      params: [owner, rpcFilter, config],
    };

    try {
      const response = await fetch(RPC_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || 'RPC error');
      }

      // The structure already matches what store.ts consumes (array under
      // `value` each with `{ account: { data: { parsed: ... }}}`). We simply
      // forward it.
      return { value: data.result?.value || [] };
    } catch (error) {
      if (!(import.meta as any).vitest) {
        console.error('Failed to fetch parsed token accounts:', error);
      }
      return { value: [] };
    }
  };

  return { getBalance, getTokenBalance, getParsedTokenAccountsByOwner };
};