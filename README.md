# 🦴 x402rocks - Automatic USDC Token Minting

Fully automatic token minting platform with USDC payment detection on Base mainnet. Users simply send USDC and automatically receive tokens - no manual transaction submission required!

## ✨ Features

- **Fully Automatic**: No manual transaction hash submission needed
- **USDC Payments**: Stable price, low fees on Base mainnet
- **Real-time Monitoring**: Detects USDC payments automatically
- **x402 Protocol**: Compliant with HTTP 402 Payment Required
- **Beautiful UI**: Stone-age themed dashboard with MetaMask integration
- **Secure**: Private keys never exposed in code

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- MetaMask wallet
- Base mainnet ETH for gas (~$10-20)
- USDC on Base for testing

### Installation

```bash
# 1. Clone/download this repository
cd x402rocks-automatic-minting

# 2. Install dependencies
npm install

# 3. Create .env file
cp .env.example .env

# 4. Edit .env with your values
nano .env

# 5. Start server
npm start
```

### Environment Variables

```env
CONTRACT_ADDRESS=0xYourDeployedContractAddress
PRIVATE_KEY=0xYourPrivateKeyHere
USDC_PAYMENT_ADDRESS=0xYourWalletAddress
BASE_RPC_URL=https://mainnet.base.org
PORT=3000
```

**⚠️ IMPORTANT**: Never commit `.env` to git! It's already in `.gitignore`.

## 📦 Project Structure

```
x402rocks-automatic-minting/
├── server-automatic.js        # Backend with automatic detection
├── public/
│   ├── index.html            # Dashboard UI
│   ├── dashboard-auto.js     # Frontend JavaScript
│   └── styles.css            # Stone-age theme CSS
├── contracts/
│   └── X402RocksToken-USDC.sol # Smart contract
├── docs/
│   ├── SAFE-DEPLOYMENT.txt   # Security guide
│   ├── AUTOMATIC-SETUP.txt   # Setup instructions
│   └── QUICK-SECURITY-GUIDE.txt # Quick reference
├── package.json              # Dependencies
├── .gitignore               # Protects .env
└── .env.example             # Template

```

## 🔧 How It Works

### User Flow (3 Simple Steps)

```
1. User connects MetaMask
2. User gets payment address
3. User sends 1 USDC
   ↓
   🤖 System auto-detects payment (15 seconds)
   🤖 System auto-verifies on-chain
   🤖 System auto-mints 50,000 tokens
   ✅ Done! (~60 seconds total)
```

### Technical Flow

**Backend:**
- Monitors USDC Transfer events on Base mainnet
- Polls blockchain every 15 seconds (backup)
- Verifies: amount, destination, confirmation
- Matches sender to pending mint request
- Automatically mints tokens via smart contract

**Frontend:**
- Polls payment status every 10 seconds
- Shows real-time updates
- Displays success message
- Updates balance automatically

## 🔐 Security

### Private Key Protection

Your private key is **NEVER** committed to GitHub:

1. `.gitignore` blocks `.env` file
2. Use Railway environment variables
3. Keep `.env` local only

### Best Practices

- ✅ Use dedicated wallet for minting (not your main wallet)
- ✅ Only fund with ~$10-20 ETH for gas
- ✅ Monitor wallet regularly
- ✅ Rotate keys every few months
- ✅ Set up transaction alerts

See `docs/SAFE-DEPLOYMENT.txt` for complete security guide.

## 🚀 Deployment

### Local Testing

```bash
npm start
# Visit http://localhost:3000
```

### Deploy to Railway

1. **Push to GitHub** (without .env!):
```bash
git add .gitignore .env.example server-automatic.js public/ contracts/ package.json
git commit -m "Add x402rocks automatic minting"
git push origin main
```

2. **Deploy on Railway**:
- Go to Railway dashboard
- Create new project from GitHub
- Add environment variables in Variables tab:
  - CONTRACT_ADDRESS
  - PRIVATE_KEY
  - USDC_PAYMENT_ADDRESS
  - BASE_RPC_URL
  - PORT

3. **Verify deployment**:
```bash
curl https://your-app.railway.app/health
```

See `docs/AUTOMATIC-SETUP.txt` for detailed instructions.

## 📝 Smart Contract Deployment

### Using Remix (Easiest)

1. Go to https://remix.ethereum.org
2. Upload `contracts/X402RocksToken-USDC.sol`
3. Compile with Solidity 0.8.20
4. Connect MetaMask to Base mainnet
5. Deploy with constructor parameters:
   - `_usdcAddress`: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
   - `_paymentReceiver`: Your wallet address
6. Copy deployed contract address
7. Add to Railway environment variables

## 🧪 Testing

### Test the Flow

1. Open dashboard at your Railway URL
2. Connect MetaMask to Base mainnet
3. Click "Get Payment Address"
4. Send 1 USDC from MetaMask
5. Watch dashboard update automatically
6. Check wallet for tokens!

### Check API Health

```bash
curl https://your-app.railway.app/health

# Should return:
# {
#   "status": "healthy",
#   "monitoring": "active",
#   "contract": "0x...",
#   "chain": "Base Mainnet"
# }
```

### Check Payment Status

```bash
curl https://your-app.railway.app/api/payment-status/{paymentId}
```

## 📊 API Endpoints

- `GET /` - Dashboard UI
- `GET /api/info` - Service information
- `GET /api/stats` - Blockchain stats
- `POST /api/request-mint` - Request payment instructions
- `GET /api/payment-status/:id` - Check payment status
- `GET /api/check-pending/:address` - Check pending payments
- `GET /api/balance/:address` - Check token balance
- `GET /health` - Health check

## 💰 Costs

- **Contract deployment**: ~$3-5 (one-time)
- **Per mint gas**: ~$0.05-0.10 (you pay)
- **User's cost**: 1 USDC + ~$0.01 gas = ~$1.01 total
- **Railway hosting**: Free tier available

## 🔗 Important Addresses

**Base Mainnet:**
- Chain ID: 8453
- RPC: https://mainnet.base.org
- Explorer: https://basescan.org

**USDC on Base:**
- Address: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Symbol: USDC
- Decimals: 6

## 📚 Documentation

- `docs/SAFE-DEPLOYMENT.txt` - Complete security and deployment guide
- `docs/AUTOMATIC-SETUP.txt` - Detailed setup instructions
- `docs/QUICK-SECURITY-GUIDE.txt` - Quick security reference

## ⚠️ Important Notes

1. **Never commit `.env`** - It's gitignored for your protection
2. **Use dedicated wallet** - Don't use your main wallet for minting
3. **Monitor regularly** - Check transactions and balances weekly
4. **Test first** - Use testnet before mainnet
5. **Keep gas** - Ensure minting wallet has ETH for gas

## 🆘 Support

If you expose your private key accidentally:
1. Transfer all funds immediately
2. Transfer contract ownership immediately
3. Generate new wallet
4. Update Railway variables
5. See `docs/SAFE-DEPLOYMENT.txt` for recovery steps

## 📄 License

MIT License - see LICENSE file for details

## 🎯 Summary

This is a **production-ready** automatic token minting platform that:

- Accepts USDC payments on Base mainnet
- Automatically detects payments (no manual submission)
- Mints tokens automatically within 60 seconds
- Provides beautiful stone-age themed UI
- Follows x402 protocol standards
- Protects your private keys
- Costs ~$1.01 per mint for users

**User experience**: Send USDC → Wait 60 seconds → Receive tokens! ✨

---

Made with 🦴 by x402rocks
