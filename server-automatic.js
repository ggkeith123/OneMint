import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { ethers } from 'ethers';

dotenv.config();

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

// Contract ABIs
const CONTRACT_ABI = [
  'function mint() external',
  'function mintTo(address recipient) external',
  'function totalMints() external view returns (uint256)',
  'function remainingMints() external view returns (uint256)',
  'function USDC_PRICE() external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
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
      const fromBlock = currentBlock - 9;    // ✅ 9 blocks - within free tier limit

      const filter = {
        address: this.usdcAddress,
        topics: [
          ethers.id('Transfer(address,address,uint256)'),
          null,
          ethers.zeroPadValue(this.paymentAddress, 32)
        ],
        fromBlock: fromBlock,
        toBlock: 'latest'
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
        
        this.mintQueue.push({
          paymentId: 'auto-' + crypto.randomBytes(8).toString('hex'),
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
      const mintRequest = this.mintQueue.shift();
      
      try {
        console.log(`🔥 Minting tokens for ${mintRequest.userAddress}...`);
        
        const tx = await contract.mintTo(mintRequest.userAddress);
        console.log(`📝 Mint transaction sent: ${tx.hash}`);
        
        const receipt = await tx.wait();
        console.log('✅ Tokens minted! Block:', receipt.blockNumber);


// Report to x402scan
console.log('🔍 Attempting to report to x402scan...');
try {
    const x402scanUrl = process.env.X402_SCAN_REPORT_URL || 'https://x402scan.com/api/report';
    
    const reportData = {
        paymentId: mintRequest.paymentId,  // ✅ Correct variable
        mintTxHash: tx.hash,               // ✅ Mint transaction hash
        status: 'completed',
        service: 'x402rocks-automatic',
        amount: '1.00',
        currency: 'USDC',
        network: 'base',
        chainId: 8453,
        timestamp: Date.now(),
        userAddress: mintRequest.userAddress,  // ✅ Correct variable
        contractAddress: CONTRACT_ADDRESS,
        blockNumber: receipt.blockNumber
    };
    
    console.log('📤 Sending to x402scan:', reportData);
    
    const response = await fetch(x402scanUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData)
    });
    
    const responseText = await response.text();
    console.log('📥 x402scan response:', response.status, responseText);
    console.log('✅ Reported to x402scan');
} catch (error) {
    console.error('❌ Failed to report to x402scan:', error.message);
}

// Update status
if (this.pendingMints.has(mintRequest.paymentId)) {


          mintData.mintTxHash = receipt.hash;
          mintData.completedAt = Date.now();
        }

      } catch (error) {
        console.error(`❌ Failed to mint for ${mintRequest.userAddress}:`, error.message);
        
        // Put back in queue to retry later
        this.mintQueue.push(mintRequest);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }

    this.isProcessing = false;
  }

  getPaymentStatus(paymentId) {
    const mintData = this.pendingMints.get(paymentId);
    
    if (!mintData) {
      return {
        found: false,
        error: 'Payment ID not found'
      };
    }

    if (Date.now() - mintData.timestamp > 30 * 60 * 1000) {
      return {
        found: true,
        status: 'expired',
        message: 'Payment window expired'
      };
    }

    return {
      found: true,
      status: mintData.status,
      userAddress: mintData.userAddress,
      paymentTxHash: mintData.txHash,
      mintTxHash: mintData.mintTxHash,
      timestamp: mintData.timestamp,
      paidAt: mintData.paidAt,
      completedAt: mintData.completedAt
    };
  }

  cleanupExpired() {
    const now = Date.now();
    for (const [paymentId, data] of this.pendingMints) {
      if (now - data.timestamp > 30 * 60 * 1000) {
        this.pendingMints.delete(paymentId);
      }
    }
    
    // Clean up old tx hashes (keep last 1000)
    if (this.processedTxHashes.size > 1000) {
      const arr = Array.from(this.processedTxHashes);
      this.processedTxHashes = new Set(arr.slice(-1000));
    }
  }
}

const monitor = new AutomaticUSDCMonitor();

// Cleanup every 5 minutes
setInterval(() => monitor.cleanupExpired(), 5 * 60000);

// =============================================================================
// API ENDPOINTS
// =============================================================================

app.get('/api/info', async (req, res) => {
  let contractInfo = {};
  
  if (contract) {
    try {
      const [totalMints, remaining] = await Promise.all([
        contract.totalMints(),
        contract.remainingMints()
      ]);
      
      contractInfo = {
        totalMints: totalMints.toString(),
        remainingMints: remaining.toString(),
        priceUSDC: '1.00'
      };
    } catch (error) {
      console.error('Contract read error:', error);
    }
  }

  res.json({
    service: 'x402rocks Automatic USDC Minting',
    description: 'Mint 50,000 tokens - just send USDC, we detect it automatically!',
    pricing: {
      amount: '1.00',
      currency: 'USDC',
      tokensPerMint: 50000
    },
    payment: {
      method: 'usdc_automatic',
      token: 'USDC',
      address: USDC_PAYMENT_ADDRESS,
      tokenAddress: BASE_CONFIG.usdcAddress,
      network: 'Base Mainnet',
      chainId: 8453,
      automatic: true,
      instructions: 'Just send 1 USDC - we monitor automatically!'
    },
    contract: {
      address: CONTRACT_ADDRESS || 'Not deployed',
      chain: 'Base Mainnet',
      chainId: 8453,
      explorer: CONTRACT_ADDRESS ? `${BASE_CONFIG.explorer}/address/${CONTRACT_ADDRESS}` : null,
      ...contractInfo
    },
    x402: {
      version: '1.0',
      compliant: true,
      automatic: true
    }
  });
});

app.get('/api/stats', async (req, res) => {
  if (!contract) {
    return res.json({
      error: 'Contract not deployed'
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
app.post('/api/request-mint', async (req, res) => {
  try {
    const { address } = req.body;

    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({
        error: 'Valid Ethereum address required'
      });
    }

    if (!contract) {
      return res.status(503).json({
        error: 'Contract not available'
      });
    }

    const instructions = monitor.createPaymentInstructions(req, address);
    
    res.status(202).json({
      message: 'Payment instructions generated. Send USDC and we will automatically mint your tokens!',
      ...instructions
    });

  } catch (error) {
    console.error('Request mint error:', error);
    res.status(500).json({
      error: 'Failed to create payment instructions',
      details: error.message
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

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    x402: 'enabled',
    paymentMethod: 'USDC automatic',
    monitoring: 'active',
    contract: CONTRACT_ADDRESS || 'not deployed',
    chain: 'Base Mainnet'
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET  /api/info',
      'GET  /api/stats',
      'POST /api/request-mint',
      'GET  /api/payment-status/:paymentId',
      'GET  /api/check-pending/:address',
      'GET  /api/balance/:address',
      'GET  /health',
      'GET  / (dashboard)'
    ]
  });
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error'
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║           x402rocks - AUTOMATIC USDC DETECTION                               ║
╚══════════════════════════════════════════════════════════════════════════════╝

✅ Server running on port ${PORT}
✅ Payment method: USDC AUTOMATIC
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

🚀 Automatic payment detection active!
  `);
});

export default app;
