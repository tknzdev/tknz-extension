import { useStore } from '../store';
import { useState, useEffect } from 'react';
import { VersionedTransaction, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';
import { Shield, AlertTriangle, ExternalLink, Zap, Key, CheckCircle } from 'lucide-react';

interface Props {
  requestId: string;
  transactions: string[]; // base64 encoded
  origin?: string | null;
  onClose(): void;
}

// Helper to decode instruction type from common program IDs
const getInstructionType = (programId: PublicKey): string => {
  const id = programId.toBase58();
  const knownPrograms: Record<string, string> = {
    '11111111111111111111111111111111': 'System Program',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'Token Program',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'Associated Token',
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter Exchange',
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'Pump.fun',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
  };
  return knownPrograms[id] || 'Unknown Program';
};

// Renders a professional cyberpunk-style transaction signing modal
export const SignTxModal: React.FC<Props> = ({ requestId, transactions, origin, onClose }) => {
  const { activeWallet } = useStore();
  const [signing, setSigning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSuccess, setIsSuccess] = useState(false);
  const [parsedTransactions, setParsedTransactions] = useState<any[]>([]);
  
  // Check if request is from launchpad
  const isFromLaunchpad = origin && (
    origin.includes('localhost') ||
    origin.includes('127.0.0.1:3001') ||
    origin.includes('tknz.fun') ||
    origin.includes('tknz-launchpad') ||
    origin.includes('launchpad')
  );
  
  console.log('SignTxModal - origin:', origin, 'isFromLaunchpad:', isFromLaunchpad);

  useEffect(() => {
    // Parse transactions to extract details
    try {
      const parsed = transactions.map((b64) => {
        const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
        const instructions = tx.message.compiledInstructions.map((ix) => {
          const programIdIndex = ix.programIdIndex;
          const programId = tx.message.staticAccountKeys[programIdIndex];
          return {
            program: getInstructionType(programId),
            programId: programId.toBase58(),
          };
        });
        return {
          version: tx.version,
          numInstructions: instructions.length,
          instructions,
          feePayer: tx.message.staticAccountKeys[0]?.toBase58(),
        };
      });
      setParsedTransactions(parsed);
    } catch (err) {
      console.error('Failed to parse transactions:', err);
    }
  }, [transactions]);

  if (!activeWallet) {
    return (
      <div className="fixed inset-0 bg-cyber-black/90 backdrop-blur-lg flex items-center justify-center z-[60] animate-fade-in">
        <div className="bg-gradient-to-b from-cyber-dark to-cyber-black border border-red-500/50 rounded-xl p-6 animate-glitch-in">
          <div className="flex items-center space-x-2 text-red-400">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-terminal">Wallet not initialized</span>
          </div>
        </div>
      </div>
    );
  }

  // Helper to display the active wallet address
  const walletAddress = (() => {
    const pk: any = activeWallet.publicKey;
    if (!pk) return 'Unknown';
    return typeof pk === 'string' ? pk : pk.toBase58 ? pk.toBase58() : String(pk);
  })();

  const handleConfirm = async () => {
    try {
      setSigning(true);
      
      // Animate through signing steps
      for (let i = 0; i <= transactions.length; i++) {
        setCurrentStep(i);
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      const signed: string[] = transactions.map((b64) => {
        const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
        const msgData = tx.message.serialize();
        const sig = nacl.sign.detached(msgData, activeWallet.keypair.secretKey);
        tx.addSignature(activeWallet.keypair.publicKey, sig);
        return Buffer.from(tx.serialize()).toString('base64');
      });

      setIsSuccess(true);
      
      // Wait for success animation
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Notify background so it can respond to the content script
      chrome.runtime.sendMessage({
        type: transactions.length === 1 ? 'SIGN_TRANSACTION_CONFIRMED' : 'SIGN_ALL_TRANSACTIONS_CONFIRMED',
        requestId,
        signedTransaction: signed.length === 1 ? signed[0] : undefined,
        signedTransactions: signed.length > 1 ? signed : undefined,
      });
      onClose();
      
      // Auto-close extension window if transaction originated from launchpad
      if (isFromLaunchpad) {
        console.log('Auto-closing extension window after successful signing from launchpad');
        setTimeout(() => {
          window.close();
        }, 200);
      }
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
    
    // Also auto-close on rejection if from launchpad
    if (isFromLaunchpad) {
      console.log('Auto-closing extension window after rejection from launchpad');
      setTimeout(() => {
        window.close();
      }, 200);
    }
  };

  return (
    <div className="fixed inset-0 bg-cyber-black/90 backdrop-blur-lg flex items-center justify-center z-[60] animate-fade-in">
      <div className="bg-gradient-to-b from-cyber-dark to-cyber-black border border-cyber-green/30 rounded-xl w-[480px] max-h-[90vh] flex flex-col animate-fade-scale-in shadow-[0_0_30px_rgba(0,255,170,0.2)]">
        {/* Header with glowing effect */}
        <div className="relative border-b border-cyber-green/20 p-6 pb-4 flex-shrink-0">
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-cyber-green to-transparent"></div>
          
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="relative">
                <Shield className="w-8 h-8 text-cyber-green" />
                <div className="absolute -inset-1 bg-cyber-green/20 blur-md rounded-full animate-pulse"></div>
              </div>
              <div>
                <h2 className="text-xl font-terminal text-cyber-green tracking-wide uppercase">
                  Transaction Signature Request
                </h2>
                <p className="text-cyber-green/60 text-xs font-terminal mt-0.5">
                  {transactions.length} transaction{transactions.length > 1 ? 's' : ''} pending
                </p>
              </div>
            </div>
            <div className="text-cyber-purple text-xs font-terminal">
              [{new Date().toLocaleTimeString()}]
            </div>
          </div>

          {/* Network indicator */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-cyber-green rounded-full animate-pulse"></div>
              <span className="text-xs font-terminal text-cyber-green/80">
                {import.meta.env.VITE_ENV === 'prod' ? 'MAINNET' : 'DEVNET'}
              </span>
            </div>
            {isSuccess && (
              <div className="flex items-center space-x-2 animate-slide-up">
                <CheckCircle className="w-4 h-4 text-cyber-green" />
                <span className="text-xs font-terminal text-cyber-green">
                  SIGNED{isFromLaunchpad && ' - CLOSING...'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Wallet info */}
        <div className="p-6 pb-4 space-y-4 flex-1 overflow-hidden flex flex-col">
          <div className="bg-cyber-black/60 border border-cyber-green/20 rounded-lg p-4 flex-shrink-0">
            <div className="flex items-center space-x-3">
              <div className="bg-cyber-green/10 rounded-full p-2">
                <Key className="w-5 h-5 text-cyber-green" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-terminal text-cyber-green/60 uppercase tracking-wide">Signing Wallet</p>
                <p className="font-mono text-sm text-cyber-green mt-1 break-all">
                  {walletAddress.slice(0, 24)}...{walletAddress.slice(-24)}
                </p>
              </div>
              <a
                href={`https://solscan.io/account/${walletAddress}${import.meta.env.VITE_ENV !== 'prod' ? '?cluster=devnet' : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 hover:bg-cyber-green/10 rounded-lg transition-colors"
                title="View on Solscan"
              >
                <ExternalLink className="w-4 h-4 text-cyber-green/70" />
              </a>
            </div>
          </div>

          {/* Transaction details */}
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <p className="text-xs font-terminal text-cyber-green/60 uppercase tracking-wide flex-shrink-0">Transaction Details</p>
            <div className="overflow-y-auto max-h-[200px] space-y-3 pr-2 scrollbar-thin scrollbar-thumb-cyber-green/20 scrollbar-track-transparent">
              {parsedTransactions.map((tx, idx) => (
                <div 
                  key={idx} 
                  className={`bg-cyber-black/40 border rounded-lg p-3 transition-all duration-300 ${
                    signing && currentStep > idx 
                      ? 'border-cyber-green shadow-[0_0_10px_rgba(0,255,170,0.3)]' 
                      : 'border-cyber-green/20'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-cyber-purple text-xs font-terminal">
                      TX {idx + 1}/{transactions.length}
                    </span>
                    {signing && currentStep === idx + 1 && (
                      <div className="flex items-center space-x-2">
                        <Zap className="w-3 h-3 text-cyber-green animate-pulse" />
                        <span className="text-xs font-terminal text-cyber-green animate-pulse">SIGNING...</span>
                      </div>
                    )}
                    {signing && currentStep > idx && (
                      <CheckCircle className="w-4 h-4 text-cyber-green" />
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    {tx.instructions.map((ix: any, iIdx: number) => (
                      <div key={iIdx} className="text-xs font-terminal">
                        <span className="text-cyber-green/60">→</span>
                        <span className="text-cyber-green ml-2">{ix.program}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Warning message */}
          <div className="bg-cyber-yellow/10 border border-cyber-yellow/30 rounded-lg p-3 flex items-start space-x-2 flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-cyber-yellow mt-0.5 flex-shrink-0" />
            <div className="text-xs font-terminal text-cyber-yellow/90">
              <p>Carefully review transaction details before signing. This action cannot be undone.</p>
              {isFromLaunchpad && (
                <p className="mt-1 text-cyber-green/80">
                  ✓ Window will close automatically after signing
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="p-6 pt-0 flex gap-3 flex-shrink-0">
          <button
            onClick={handleReject}
            className="flex-1 px-4 py-3 rounded-lg bg-cyber-black border border-red-500/50 text-red-400 font-terminal 
                     hover:bg-red-500/10 hover:border-red-500 hover:shadow-[0_0_10px_rgba(255,0,0,0.3)]
                     transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={signing}
          >
            REJECT
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-3 rounded-lg bg-gradient-to-r from-cyber-green to-cyber-green-dark 
                     text-cyber-black font-terminal font-bold tracking-wide
                     hover:shadow-[0_0_20px_rgba(0,255,170,0.5)] hover:from-cyber-green-dark hover:to-cyber-green
                     transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center justify-center space-x-2"
            disabled={signing}
          >
            {signing ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>SIGNING...</span>
              </>
            ) : isSuccess ? (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>SIGNED{isFromLaunchpad && ' - CLOSING'}</span>
              </>
            ) : (
              <>
                <Shield className="w-4 h-4" />
                <span>CONFIRM</span>
              </>
            )}
          </button>
        </div>

        {/* Decorative bottom border */}
        <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-cyber-green/50 to-transparent"></div>
      </div>
    </div>
  );
};
