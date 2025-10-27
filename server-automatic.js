import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { ethers } from 'ethers';

dotenv.config();

// =============================================================================
// DEBUG: Check environment variables on startup
// =============================================================================
console.log('🔍 Environment Variables Check:');
console.log('CONTRACT_ADDRESS:', process.env.CONTRACT_ADDRESS || '❌ MISSING');
console.log('USDC_PAYMENT_ADDRESS:', process.env.USDC_PAYMENT_ADDRESS || '❌ MISSING');
console.log('PRIVATE_KEY:', process.env.PRIVATE_KEY ? '✅ Loaded' : '❌ MISSING');
console.log('BASE_RPC_URL:', process.env.BASE_RPC_URL ? '✅ Loaded' : '⚠️  Using default');
console.log('');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// =============================================================================
// BASE MAINNET + USDC CONFIGURATION
// =============================================================================

const BASE_CONFIG = {
  chainId: 8453,
  name: 'Base Mainnet',
  rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  explorer: 'https://basescan.org',
  usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
};

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const USDC_PAYMENT_ADDRESS = process.env.USDC_PAYMENT_ADDRESS || '';
const USDC_ADDRESS = BASE_CONFIG.usdcAddress;

// Contract ABIs
const CONTRACT_ABI = [
  'function mint() external',
  'function mintTo(address recipient) external',
  'function totalMints() external view returns (uint256)',
  'function remainingMints() external view returns (uint256)',
  'function USDC_PRICE() external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function mintsPerAddress(address account) external view returns (uint256)',
  'event TokensMinted(address indexed recipient, uint256 tokenAmount, uint256 usdcPaid, uint256 mintNumber)'
];

const USDC_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// Initialize
let provider, wallet, contract, usdcContract;

try {
  provider = new ethers.JsonRpcProvider(BASE_CONFIG.rpcUrl);
  
  if (PRIVATE_KEY && PRIVATE_KEY.length === 66) {
    wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    
    if (CONTRACT_ADDRESS) {
      contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
      usdcContract = new ethers.Contract(BASE_CONFIG.usdcAddress, USDC_ABI, provider);
    }
  }
} catch (error) {
  console.warn('⚠️  Contract not initialized:', error.message);
}

// =============================================================================
// AUTOMATIC USDC PAYMENT MONITOR
// =============================================================================

class AutomaticUSDCMonitor {
  constructor() {
    this.pendingMints = new Map(); // paymentId -> { userAddress, timestamp, status }
    this.processedTxHashes = new Set(); // Prevent duplicate processing
    this.mintQueue = []; // Queue for minting
    this.isProcessing = false;
    this.usdcAddress = BASE_CONFIG.usdcAddress;
    this.paymentAddress = USDC_PAYMENT_ADDRESS;
    this.priceUSDC = '1.00';
    
    // Start monitoring if we have everything configured
    if (provider && usdcContract && this.paymentAddress) {
      this.startMonitoring();
    }
  }

  generatePaymentId() {
    return crypto.randomBytes(16).toString('hex');
  }

  createPaymentInstructions(req, userAddress) {
    const paymentId = this.generatePaymentId();
    const timestamp = Date.now();

    // Store pending mint request
    this.pendingMints.set(paymentId, {
      userAddress: userAddress.toLowerCase(),
      timestamp,
      status: 'waiting_for_payment'
    });

    return {
      version: '1.0',
      paymentId: paymentId,
      
      resource: {
        url: '/api/mint',
        description: 'Mint 50,000 x402rocks tokens'
      },
      
      payment: {
        amount: this.priceUSDC,
        currency: 'USDC',
        method: 'usdc_automatic',
        
        usdc: {
          token: 'USDC',
          address: this.paymentAddress,
          tokenAddress: this.usdcAddress,
          network: 'Base Mainnet',
          chainId: 8453,
          amount: '1000000', // 1 USDC (6 decimals)
          instructions: 'Send 1 USDC from your wallet. We will automatically detect your payment and mint tokens!',
          note: 'No need to submit transaction hash - we monitor automatically!',
          explorerUrl: `${BASE_CONFIG.explorer}/address/${this.paymentAddress}`
        }
      },
      
      monitoring: {
        automatic: true,
        checkInterval: '10 seconds',
        timeout: '30 minutes',
        statusEndpoint: `${req.protocol}://${req.get('host')}/api/payment-status/${paymentId}`
      },
      
      expiresAt: timestamp + (30 * 60 * 1000),
      
      service: {
        name: 'x402rocks Automatic USDC Minting',
        url: `${req.protocol}://${req.get('host')}`,
        contract: CONTRACT_ADDRESS || 'Not deployed'
      }
    };
  }

  async startMonitoring() {
    console.log('🔍 Starting automatic USDC payment monitoring...');
    console.log(`📍 Monitoring address: ${this.paymentAddress}`);
    
    // Monitor for USDC Transfer events
    const filter = {
      address: this.usdcAddress,
      topics: [
        ethers.id('Transfer(address,address,uint256)'),
        null, // from (any address)
        ethers.zeroPadValue(this.paymentAddress, 32) // to (our payment address)
      ]
    };

    // Listen for new transfers
    provider.on(filter, async (log) => {
      await this.handleUSDCTransfer(log);
    });

    // Also poll for recent transfers every 15 seconds
    setInterval(() => this.pollRecentTransfers(), 15000);
    
    // Initial check
    this.pollRecentTransfers();
    
    console.log('✅ USDC payment monitoring active!');
  }

  async pollRecentTransfers() {
    if (!provider || !this.paymentAddress) return;

    try {
      const currentBlock = await provider.getBlockNumber();
      
      // ⚡ ALCHEMY FREE TIER FIX: Only scan 9 blocks at a time
      const fromBlock = currentBlock - 9;

      const filter = {
        address: this.usdcAddress,
        topics: [
          ethers.id('Transfer(address,address,uint256)'),
          null,
          ethers.zeroPadValue(this.paymentAddress, 32)
        ],
        fromBlock: fromBlock,
        toBlock: currentBlock // ✅ Use currentBlock instead of 'latest'
      };

      const logs = await provider.getLogs(filter);
      
      for (const log of logs) {
        await this.handleUSDCTransfer(log);
      }
    } catch (error) {
      console.error('Error polling transfers:', error.message);
    }
  }

  async handleUSDCTransfer(log) {
    try {
      const txHash = log.transactionHash;

      // Skip if already processed
      if (this.processedTxHashes.has(txHash)) {
        return;
      }

      // Decode the transfer event
      const iface = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
      const decoded = iface.parseLog(log);
      
      const from = decoded.args.from.toLowerCase();
      const to = decoded.args.to.toLowerCase();
      const amount = decoded.args.value;

      // Verify it's to our address and amount is >= 1 USDC
      if (to !== this.paymentAddress.toLowerCase() || amount < 1000000n) {
        return;
      }

      console.log('💰 USDC payment detected!', {
        from,
        amount: ethers.formatUnits(amount, 6),
        txHash
      });

      // Mark as processed
      this.processedTxHashes.add(txHash);

      // Find pending mint for this sender
      let paymentId = null;
      for (const [pid, data] of this.pendingMints.entries()) {
        if (data.userAddress === from && data.status === 'waiting_for_payment') {
          paymentId = pid;
          break;
        }
      }

      if (paymentId) {
        // Update status
        const mintData = this.pendingMints.get(paymentId);
        mintData.status = 'payment_received';
        mintData.txHash = txHash;
        mintData.paidAt = Date.now();

        // Add to mint queue
        this.mintQueue.push({
          paymentId,
          userAddress: from,
          txHash
        });

        console.log(`✅ Payment matched to pending mint: ${paymentId}`);
        
        // Process queue
        this.processMintQueue();
      } else {
        // No pending request, but user paid - mint anyway!
        console.log('⚡ No pending request found, but payment received. Auto-minting...');
        
        const autoPaymentId = 'auto-' + crypto.randomBytes(8).toString('hex');
        
        // Store it in pendingMints
        this.pendingMints.set(autoPaymentId, {
          userAddress: from,
          timestamp: Date.now(),
          status: 'payment_received',
          txHash: txHash,
          paidAt: Date.now(),
          auto: true
        });
        
        this.mintQueue.push({
          paymentId: autoPaymentId,
          userAddress: from,
          txHash
        });
        
        this.processMintQueue();
      }
    } catch (error) {
      console.error('Error handling USDC transfer:', error);
    }
  }

  async processMintQueue() {
    if (this.isProcessing || this.mintQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.mintQueue.length > 0) {
      const item = this.mintQueue.shift();
      
      try {
        await this.mintTokens(item.paymentId, item.userAddress, item.txHash);
      } catch (error) {
        console.error('Error minting tokens:', error);
        
        // Update status
        const mintData = this.pendingMints.get(item.paymentId);
        if (mintData) {
          mintData.status = 'mint_failed';
          mintData.error = error.message;
        }
      }
    }

    this.isProcessing = false;
  }

  async mintTokens(paymentId, userAddress, paymentTxHash) {
    if (!contract) {
      throw new Error('Contract not initialized');
    }

    console.log(`🎨 Minting tokens for ${userAddress}...`);

    const mintData = this.pendingMints.get(paymentId);
    if (!mintData) {
      throw new Error('Payment data not found');
    }

    // Update status
    mintData.status = 'minting';
    mintData.mintingAt = Date.now();

    try {
      // Call mintTo function
      const tx = await contract.mintTo(userAddress);
      console.log(`📤 Mint transaction sent: ${tx.hash}`);
      
      mintData.mintTxHash = tx.hash;

      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(`✅ Mint successful! Block: ${receipt.blockNumber}`);

      // Update final status
      mintData.status = 'completed';
      mintData.completedAt = Date.now();
      mintData.mintBlockNumber = receipt.blockNumber;

      return {
        success: true,
        paymentTxHash,
        mintTxHash: tx.hash,
        blockNumber: receipt.blockNumber
      };

    } catch (error) {
      console.error('Mint transaction failed:', error);
      mintData.status = 'mint_failed';
      mintData.error = error.message;
      throw error;
    }
  }

  getPaymentStatus(paymentId) {
    const data = this.pendingMints.get(paymentId);
    
    if (!data) {
      return {
        found: false,
        paymentId: paymentId,
        message: 'Payment ID not found'
      };
    }

    return {
      found: true,
      paymentId: paymentId,
      userAddress: data.userAddress,
      status: data.status,
      timestamp: data.timestamp,
      txHash: data.txHash,
      mintTxHash: data.mintTxHash,
      paidAt: data.paidAt,
      mintingAt: data.mintingAt,
      completedAt: data.completedAt,
      blockNumber: data.mintBlockNumber,
      error: data.error,
      explorerUrl: data.mintTxHash ? `${BASE_CONFIG.explorer}/tx/${data.mintTxHash}` : undefined
    };
  }
}

// Initialize monitor
const monitor = new AutomaticUSDCMonitor();

// =============================================================================
// API ENDPOINTS
// =============================================================================



app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    service: 'x402rocks',
    version: '2.0.0'
  });
});

app.get('/api/info', async (req, res) => {
  if (!CONTRACT_ADDRESS) {
    return res.status(503).json({
      error: 'Service not ready',
      message: 'Contract not deployed yet. Please check your environment variables.',
      required: [
        'CONTRACT_ADDRESS',
        'USDC_PAYMENT_ADDRESS',
        'PRIVATE_KEY'
      ]
    });
  }

  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    res.json({
      // x402scan required fields
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "base",
          maxAmountRequired: "1000000",
          resource: "/api/request-mint",
          description: "Mint 50,000 x402rocks tokens by paying 1 USDC",
          mimeType: "application/json",
          payTo: USDC_PAYMENT_ADDRESS,
          maxTimeoutSeconds: 1800,
          asset: USDC_ADDRESS,
          
          outputSchema: {
            input: {
              type: "http",
              method: "POST",
              bodyType: "json",
              bodyFields: {
                address: {
                  type: "string",
                  required: true,
                  description: "Ethereum address to receive tokens"
                }
              }
            }
          },
          
          extra: {
            service: 'x402rocks Token Minting',
            description: 'Mint 50,000 x402rocks tokens with automatic USDC payment detection',
            contract: {
              address: CONTRACT_ADDRESS,
              chain: 'Base Mainnet',
              chainId: 8453,
              explorer: `${BASE_CONFIG.explorer}/address/${CONTRACT_ADDRESS}`,
              tokenSymbol: 'X402',
              tokensPerMint: '50000'
            },
            payment: {
              method: 'usdc_automatic',
              amount: '1.00',
              currency: 'USDC',
              address: USDC_PAYMENT_ADDRESS,
              tokenAddress: USDC_ADDRESS,
              automatic: true,
              note: 'Send USDC and tokens will be automatically minted to your address'
            },
            endpoints: {
              info: `${baseUrl}/api/info`,
              stats: `${baseUrl}/api/stats`,
              requestMint: `${baseUrl}/api/request-mint`,
              paymentStatus: `${baseUrl}/api/payment-status/:paymentId`,
              checkPending: `${baseUrl}/api/check-pending/:address`,
              balance: `${baseUrl}/api/balance/:address`,
              payaiInfo: `${baseUrl}/api/payai-info`,
              payaiMint: `${baseUrl}/api/payai-mint`,
              payaiHealth: `${baseUrl}/api/payai-health`
            },
            features: [
              'automatic-usdc-detection',
              'no-manual-submission',
              'instant-minting',
              'payai-compatible',
              'x402-protocol'
            ]
          }
        }
      ],
      
      // ✅ BACKWARD COMPATIBILITY - Keep these for your dashboard
      version: '1.0',
      service: 'x402rocks Token Minting',
      description: 'Mint 50,000 x402rocks tokens with automatic USDC payment detection',
      
      contract: {
        address: CONTRACT_ADDRESS,
        chain: 'Base Mainnet',
        chainId: 8453,
        explorer: `${BASE_CONFIG.explorer}/address/${CONTRACT_ADDRESS}`,
        tokenSymbol: 'X402',
        tokensPerMint: '50000'
      },
      
      payment: {
        method: 'usdc_automatic',
        amount: '1.00',
        currency: 'USDC',
        address: USDC_PAYMENT_ADDRESS,
        tokenAddress: USDC_ADDRESS,
        automatic: true,
        note: 'Send USDC and tokens will be automatically minted to your address'
      },
      
      endpoints: {
        info: `${baseUrl}/api/info`,
        stats: `${baseUrl}/api/stats`,
        requestMint: `${baseUrl}/api/request-mint`,
        paymentStatus: `${baseUrl}/api/payment-status/:paymentId`,
        checkPending: `${baseUrl}/api/check-pending/:address`,
        balance: `${baseUrl}/api/balance/:address`,
        payaiInfo: `${baseUrl}/api/payai-info`,
        payaiMint: `${baseUrl}/api/payai-mint`,
        payaiHealth: `${baseUrl}/api/payai-health`
      },
      
      features: [
        'automatic-usdc-detection',
        'no-manual-submission',
        'instant-minting',
        'payai-compatible',
        'x402-protocol'
      ]
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get service info',
      message: error.message 
    });
  }
});


app.get('/api/stats', async (req, res) => {
  if (!contract) {
    return res.json({
      error: 'Contract not deployed',
      totalMints: '0',
      remainingMints: '40000',
      maxMints: 40000,
      tokensPerMint: 50000,
      price: {
        usdc: '1.00',
        currency: 'USDC'
      }
    });
  }

  try {
    const [totalMints, remaining] = await Promise.all([
      contract.totalMints(),
      contract.remainingMints()
    ]);

    res.json({
      totalMints: totalMints.toString(),
      remainingMints: remaining.toString(),
      maxMints: 40000,
      tokensPerMint: 50000,
      totalSupply: (Number(totalMints) * 50000).toString(),
      price: {
        usdc: '1.00',
        currency: 'USDC'
      },
      contract: {
        address: CONTRACT_ADDRESS,
        chain: 'Base Mainnet',
        explorer: `${BASE_CONFIG.explorer}/address/${CONTRACT_ADDRESS}`
      },
      monitoring: {
        active: true,
        automatic: true
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch stats',
      details: error.message
    });
  }
});

/**
 * Request mint - returns payment instructions with automatic monitoring
 */
app.post('/api/request-mint', (req, res) => {
  const { address } = req.body;

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({
      error: 'Invalid address provided'
    });
  }

  if (!CONTRACT_ADDRESS || !USDC_PAYMENT_ADDRESS) {
    return res.status(503).json({
      error: 'Service not ready',
      message: 'Contract or payment address not configured'
    });
  }

  try {
    const instructions = monitor.createPaymentInstructions(req, address);
    res.json(instructions);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to create payment instructions',
      details: error.message
    });
  }
});

/**
 * PayAI mint endpoint
 */
app.post('/api/payai-mint', async (req, res) => {
  try {
    const { recipientAddress, agentId, metadata } = req.body;

    if (!recipientAddress || !recipientAddress.startsWith('0x') || recipientAddress.length !== 42) {
      return res.status(400).json({ 
        error: 'Invalid recipient address',
        details: 'Address must be a valid Ethereum address (0x... 42 characters)'
      });
    }

    // Use the monitor's payment system
    const instructions = monitor.createPaymentInstructions(req, recipientAddress);

    // Return PayAI-compatible response
    res.json({
      success: true,
      paymentId: instructions.paymentId,
      
      payment: {
        address: USDC_PAYMENT_ADDRESS,
        amount: '1000000',
        amountFormatted: '1 USDC',
        token: USDC_ADDRESS,
        tokenSymbol: 'USDC',
        chain: 'Base',
        chainId: 8453,
        network: 'mainnet'
      },
      
      receive: {
        amount: '50000',
        token: 'X402',
        tokenAddress: CONTRACT_ADDRESS
      },
      
      instructions: 'Send exactly 1 USDC to the payment address. Tokens will be minted automatically within 60 seconds.',
      
      statusUrl: instructions.monitoring.statusEndpoint,
      
      estimatedTime: '30-60 seconds',
      expiresAt: instructions.expiresAt
    });

  } catch (error) {
    console.error('PayAI mint error:', error);
    res.status(500).json({ 
      error: 'Failed to process PayAI mint request',
      message: error.message 
    });
  }
});

/**
 * Check payment status
 */
app.get('/api/payment-status/:paymentId', (req, res) => {
  const { paymentId } = req.params;
  const status = monitor.getPaymentStatus(paymentId);
  
  res.json(status);
});

/**
 * Check if address has pending payment
 */
app.get('/api/check-pending/:address', (req, res) => {
  const { address } = req.params;
  
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Invalid address' });
  }

  const normalizedAddress = address.toLowerCase();
  
  for (const [paymentId, data] of monitor.pendingMints.entries()) {
    if (data.userAddress === normalizedAddress) {
      return res.json({
        hasPending: true,
        paymentId,
        status: data.status,
        timestamp: data.timestamp
      });
    }
  }
  
  res.json({
    hasPending: false
  });
});

app.get('/api/balance/:address', async (req, res) => {
  const { address } = req.params;

  if (!ethers.isAddress(address)) {
    return res.status(400).json({
      error: 'Invalid address'
    });
  }

  if (!contract) {
    return res.json({
      address: address,
      balance: '0',
      symbol: 'X402',
      note: 'Contract not deployed'
    });
  }

  try {
    const balance = await contract.balanceOf(address);
    const mints = await contract.mintsPerAddress(address);

    res.json({
      address: address,
      balance: ethers.formatUnits(balance, 18),
      mints: mints.toString(),
      symbol: 'X402',
      contract: CONTRACT_ADDRESS,
      explorer: `${BASE_CONFIG.explorer}/token/${CONTRACT_ADDRESS}?a=${address}`
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch balance',
      details: error.message
    });
  }
});

app.get('/api/payai-health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'x402rocks',
    facilitator: 'PayAI',
    timestamp: Date.now(),
    monitoring: CONTRACT_ADDRESS && USDC_PAYMENT_ADDRESS ? 'active' : 'inactive',
    contract: CONTRACT_ADDRESS ? 'deployed' : 'not deployed'
  });
});

// Root endpoint - check for x402scan query parameter
app.get('/', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  // If ?x402 query param or JSON accept header, return 402
  if (req.query.x402 !== undefined || req.path === '/.well-known/payment-required') {
    return res.status(402).json({
      x402Version: 1,
      error: "Payment required",
      accepts: [
        {
          scheme: "exact",
          network: "base",
          maxAmountRequired: "1000000",
          resource: "/api/request-mint",
          description: "Mint 50,000 x402rocks tokens by paying 1 USDC",
          mimeType: "application/json",
          payTo: USDC_PAYMENT_ADDRESS,
          maxTimeoutSeconds: 1800,
          asset: USDC_ADDRESS,
          
          outputSchema: {
            input: {
              type: "http",
              method: "POST",
              bodyType: "json",
              bodyFields: {
                address: {
                  type: "string",
                  required: true,
                  description: "Ethereum address to receive tokens"
                }
              }
            }
          },
          
          extra: {
            service: 'x402rocks',
            contractAddress: CONTRACT_ADDRESS,
            chainId: 8453,
            dashboardUrl: baseUrl,
            infoUrl: `${baseUrl}/api/info`
          }
        }
      ]
    });
  }
  
  // Serve dashboard for regular requests
  res.sendFile('index.html', { root: './public' });
});

// Also add dedicated 402 endpoint
app.get('/.well-known/payment-required', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  res.status(402).json({
    x402Version: 1,
    error: "Payment required",
    accepts: [
      {
        scheme: "exact",
        network: "base",
        maxAmountRequired: "1000000",
        resource: "/api/request-mint",
        description: "Mint 50,000 x402rocks tokens by paying 1 USDC",
        mimeType: "application/json",
        payTo: USDC_PAYMENT_ADDRESS,
        maxTimeoutSeconds: 1800,
        asset: USDC_ADDRESS,
        
        extra: {
          service: 'x402rocks',
          contractAddress: CONTRACT_ADDRESS,
          chainId: 8453
        }
      }
    ]
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
    
╔══════════════════════════════════════════════════════════════════════════════╗
║           x402rocks - AUTOMATIC USDC DETECTION + PAYAI                       ║
╚══════════════════════════════════════════════════════════════════════════════╝

✅ Server running on port ${PORT}
✅ Payment method: USDC AUTOMATIC
✅ PayAI facilitator: ENABLED
✅ No manual transaction submission needed!

Configuration:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  USDC payment address: ${USDC_PAYMENT_ADDRESS || '⚠️  Not configured'}
  USDC token address: ${BASE_CONFIG.usdcAddress}
  Contract: ${CONTRACT_ADDRESS || '⚠️  NOT DEPLOYED'}
  Monitoring: ${USDC_PAYMENT_ADDRESS && CONTRACT_ADDRESS ? '🟢 ACTIVE' : '🔴 INACTIVE'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

How it works:
1. User sends 1 USDC to payment address
2. System automatically detects payment
3. Tokens automatically minted to sender
4. Done! No manual steps!

Dashboard: http://localhost:${PORT}
PayAI Info: http://localhost:${PORT}/api/payai-info

🚀 Automatic payment detection active!
  `);
});

export default app;
