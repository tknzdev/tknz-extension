import { useStore } from '../store';
import { useState } from 'react';
import { VersionedTransaction } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';

interface Props {
  requestId: string;
  transactions: string[]; // base64 encoded
  onClose(): void;
}

// Renders a simple Phantom-style confirm dialog that lists how many
// transactions need signing and the wallet that will sign them.
export const SignTxModal: React.FC<Props> = ({ requestId, transactions, onClose }) => {
  const { activeWallet } = useStore();
  const [signing, setSigning] = useState(false);

  if (!activeWallet) {
    return (
      <div className="p-4 text-red-400">Wallet not initialized.</div>
    );
  }

  // Helper to display the active wallet address defensively
  const walletAddress = (() => {
    const pk: any = activeWallet.publicKey;
    if (!pk) return 'Unknown';
    return typeof pk === 'string' ? pk : pk.toBase58 ? pk.toBase58() : String(pk);
  })();

  const handleConfirm = async () => {
    try {
      setSigning(true);

      const signed: string[] = transactions.map((b64) => {
        const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
        const msgData = tx.message.serialize();
        const sig = nacl.sign.detached(msgData, activeWallet.keypair.secretKey);
        tx.addSignature(activeWallet.keypair.publicKey, sig);
        return Buffer.from(tx.serialize()).toString('base64');
      });

      // Notify background so it can respond to the content script
      chrome.runtime.sendMessage({
        type: transactions.length === 1 ? 'SIGN_TRANSACTION_CONFIRMED' : 'SIGN_ALL_TRANSACTIONS_CONFIRMED',
        requestId,
        signedTransaction: signed.length === 1 ? signed[0] : undefined,
        signedTransactions: signed.length > 1 ? signed : undefined,
      });
      onClose();
    } catch (err) {
      console.error('Signing failed', err);
      setSigning(false);
    }
  };

  const handleReject = () => {
    chrome.runtime.sendMessage({
      type: transactions.length === 1 ? 'SIGN_TRANSACTION_REJECTED' : 'SIGN_ALL_TRANSACTIONS_REJECTED',
      requestId,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/70 z-50">
      <div className="bg-neutral-900 rounded-xl p-6 w-96">
        <h2 className="text-lg font-semibold mb-4 text-white">Sign {transactions.length} Transaction{transactions.length > 1 ? 's' : ''}</h2>
        <p className="text-sm text-gray-300 mb-6 break-words">
          Wallet: <span className="font-mono">{walletAddress}</span>
        </p>
        <div className="flex gap-4 justify-end">
          <button
            onClick={handleReject}
            className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
            disabled={signing}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
            disabled={signing}
          >
            {signing ? 'Signing…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};
