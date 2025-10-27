const API_URL = window.location.origin;
let currentPaymentId = null;
let statusCheckInterval = null;
let userWalletAddress = null;

// Show alert
function showAlert(message, type = 'info') {
    const alert = document.getElementById('alert');
    alert.textContent = '🦴 ' + message;
    alert.className = `alert ${type} show`;
    setTimeout(() => alert.classList.remove('show'), 8000);
}

// Load service info
async function loadServiceInfo() {
    try {
        const response = await fetch(`${API_URL}/api/info`);
        const data = await response.json();

        document.getElementById('paymentAddress').textContent = data.payment.address;
        
        if (data.contract.address && data.contract.address !== 'Not deployed') {
            const shortAddr = data.contract.address.slice(0, 10) + '...' + data.contract.address.slice(-8);
            document.getElementById('contractAddress').innerHTML = 
                `<a href="${data.contract.explorer}" target="_blank" class="link">${shortAddr}</a>`;
        }

    } catch (error) {
        console.error('Error loading service info:', error);
    }
}

// Load stats
async function loadStats() {
    try {
        const response = await fetch(`${API_URL}/api/stats`);
        const data = await response.json();

        if (data.error) {
            document.getElementById('totalMints').textContent = '-';
            document.getElementById('remainingMints').textContent = '-';
            return;
        }

        document.getElementById('totalMints').textContent = data.totalMints;
        document.getElementById('remainingMints').textContent = data.remainingMints;
        document.getElementById('price').textContent = `${data.price.usdc} USDC`;

        const progress = (data.totalMints / data.maxMints * 100).toFixed(1);
        const progressBar = document.getElementById('progressBar');
        progressBar.style.width = progress + '%';
        progressBar.textContent = progress + '%';

    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Connect wallet
async function connectWallet() {
    if (typeof window.ethereum === 'undefined') {
        showAlert('Please install MetaMask!', 'error');
        window.open('https://metamask.io/download/', '_blank');
        return;
    }

    try {
        const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
        userWalletAddress = accounts[0];
        document.getElementById('walletAddress').value = userWalletAddress;
        showAlert('Wallet connected! ' + userWalletAddress.slice(0, 10) + '...', 'success');
        
        // Switch to Base
        try {
            await ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x2105' }],
            });
        } catch (error) {
            if (error.code === 4902) {
                await ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: '0x2105',
                        chainName: 'Base Mainnet',
                        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                        rpcUrls: ['https://mainnet.base.org'],
                        blockExplorerUrls: ['https://basescan.org']
                    }]
                });
            }
        }

        // Check for pending payments
        checkPendingPayment(userWalletAddress);

    } catch (error) {
        console.error('Wallet connection error:', error);
        showAlert('Failed to connect wallet', 'error');
    }
}

// Check for pending payment
async function checkPendingPayment(address) {
    try {
        const response = await fetch(`${API_URL}/api/check-pending/${address}`);
        const data = await response.json();

        if (data.hasPending) {
            currentPaymentId = data.paymentId;
            showAlert(`You have a pending payment! Status: ${data.status}`, 'info');
            
            if (data.status === 'waiting_for_payment') {
                // Show modal with instructions
                document.getElementById('paymentModal').classList.add('show');
            } else if (data.status === 'payment_received') {
                showAlert('Payment received! Minting your tokens...', 'success');
                startStatusCheck(data.paymentId);
            }
        }
    } catch (error) {
        console.error('Error checking pending payment:', error);
    }
}

// Direct mint with USDC (one-click!)
async function mintDirectly() {
    const address = document.getElementById('walletAddress').value.trim();

    if (!address) {
        showAlert('Please connect your wallet first!', 'error');
        return;
    }

    if (typeof window.ethereum === 'undefined') {
        showAlert('Please install MetaMask!', 'error');
        return;
    }

    if (typeof ethers === 'undefined') {
        showAlert('Loading libraries... Please refresh the page and try again.', 'error');
        console.error('Ethers.js not loaded. Please check your internet connection.');
        return;
    }

    try {
        showAlert('Preparing to mint... Please approve in MetaMask', 'info');

        // Get contract info
        const infoResponse = await fetch(`${API_URL}/api/info`);
        const info = await infoResponse.json();

        if (!info.contract || !info.contract.address || info.contract.address === 'Not deployed') {
            showAlert('Contract not deployed yet. Please deploy the contract first.', 'error');
            return;
        }

        const contractAddress = info.contract.address;
        const usdcAddress = info.payment.tokenAddress;

        // Initialize ethers
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();

        // USDC contract
        const usdcABI = [
            'function approve(address spender, uint256 amount) external returns (bool)',
            'function allowance(address owner, address spender) external view returns (uint256)'
        ];
        const usdcContract = new ethers.Contract(usdcAddress, usdcABI, signer);

        // Token contract
        const tokenABI = [
            'function mint() external'
        ];
        const tokenContract = new ethers.Contract(contractAddress, tokenABI, signer);

        // Check and approve USDC
        showAlert('Step 1/2: Approving USDC...', 'info');
        const allowance = await usdcContract.allowance(address, contractAddress);
        const requiredAmount = ethers.utils.parseUnits('1', 6); // 1 USDC

        if (allowance.lt(requiredAmount)) {
            const approveTx = await usdcContract.approve(contractAddress, requiredAmount);
            showAlert('Waiting for approval confirmation...', 'info');
            await approveTx.wait();
            showAlert('✅ USDC approved!', 'success');
        }

        // Mint tokens
        showAlert('Step 2/2: Minting tokens... Please confirm in MetaMask', 'info');
        const mintTx = await tokenContract.mint();
        showAlert('Transaction sent! Waiting for confirmation...', 'info');
        
        const receipt = await mintTx.wait();
        
        showAlert('🎉 SUCCESS! 50,000 tokens minted! TX: ' + receipt.transactionHash.slice(0, 10) + '...', 'success');
        
        // Refresh stats
        loadStats();
        
        // Check balance
        setTimeout(() => checkBalance(address), 2000);

    } catch (error) {
        console.error('Mint error:', error);
        
        if (error.code === 4001) {
            showAlert('Transaction cancelled by user', 'error');
        } else if (error.message.includes('insufficient funds')) {
            showAlert('Insufficient USDC balance or ETH for gas', 'error');
        } else {
            showAlert('Minting failed: ' + error.message, 'error');
        }
    }
}

// Get payment instructions (alternative method)
async function getPaymentInstructions() {
    const address = document.getElementById('walletAddress').value.trim();

    if (!address) {
        showAlert('Please enter or connect your wallet address!', 'error');
        return;
    }

    if (!address.startsWith('0x') || address.length !== 42) {
        showAlert('Please enter a valid Ethereum address!', 'error');
        return;
    }

    try {
        showAlert('Creating payment request...', 'info');

        const response = await fetch(`${API_URL}/api/request-mint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: address })
        });

        if (response.ok) {
            const data = await response.json();
            currentPaymentId = data.paymentId;

            // Show modal with payment info
            document.getElementById('modalPaymentAddress').textContent = data.payment.usdc.address;
            document.getElementById('modalPaymentId').textContent = data.paymentId;
            document.getElementById('paymentModal').classList.add('show');
            
            showAlert('Send 1 USDC to the address shown. We will detect it automatically!', 'info');

            // Start checking status
            startStatusCheck(data.paymentId);

        } else {
            throw new Error('Failed to create payment request');
        }

    } catch (error) {
        console.error('Error:', error);
        showAlert('Failed to create payment request: ' + error.message, 'error');
    }
}

// Start checking payment status
function startStatusCheck(paymentId) {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
    }

    let checkCount = 0;
    const maxChecks = 180; // 30 minutes / 10 seconds

    statusCheckInterval = setInterval(async () => {
        checkCount++;

        try {
            const response = await fetch(`${API_URL}/api/payment-status/${paymentId}`);
            const status = await response.json();

            if (!status.found) {
                clearInterval(statusCheckInterval);
                showAlert('Payment ID not found', 'error');
                return;
            }

            console.log('Payment status:', status.status);

            if (status.status === 'payment_received') {
                showAlert('💰 Payment received! Minting your tokens...', 'success');
            } else if (status.status === 'completed') {
                clearInterval(statusCheckInterval);
                document.getElementById('paymentModal').classList.remove('show');
                
                showAlert(
                    `🎉 SUCCESS! 50,000 tokens minted! TX: ${status.mintTxHash.slice(0, 10)}...`,
                    'success'
                );
                
                loadStats();
                
                // Check balance
                if (userWalletAddress) {
                    setTimeout(() => checkBalance(userWalletAddress), 2000);
                }
            } else if (status.status === 'expired') {
                clearInterval(statusCheckInterval);
                showAlert('Payment window expired. Please try again.', 'error');
                document.getElementById('paymentModal').classList.remove('show');
            }

            if (checkCount >= maxChecks) {
                clearInterval(statusCheckInterval);
                showAlert('Status check timeout. Please refresh the page.', 'error');
            }

        } catch (error) {
            console.error('Status check error:', error);
        }

    }, 10000); // Check every 10 seconds
}

// Check balance
async function checkBalance(address) {
    if (!address) {
        address = document.getElementById('checkAddress').value.trim();
    }

    if (!address || !address.startsWith('0x')) {
        showAlert('Please enter a valid address!', 'error');
        return;
    }

    try {
        document.getElementById('checkBalance').disabled = true;
        
        const response = await fetch(`${API_URL}/api/balance/${address}`);
        const data = await response.json();

        document.getElementById('balanceAmount').textContent = 
            parseFloat(data.balance).toLocaleString() + ' X402';
        document.getElementById('balanceResult').style.display = 'block';

        if (parseFloat(data.balance) === 0) {
            showAlert('No tokens found for this address', 'info');
        } else {
            showAlert(`Balance: ${parseFloat(data.balance).toLocaleString()} tokens`, 'success');
        }

    } catch (error) {
        console.error('Balance error:', error);
        showAlert('Failed to check balance', 'error');
    } finally {
        document.getElementById('checkBalance').disabled = false;
    }
}

// Event listeners
document.getElementById('connectWallet').addEventListener('click', connectWallet);
document.getElementById('mintDirectly').addEventListener('click', mintDirectly);
document.getElementById('getMintInstructions').addEventListener('click', getPaymentInstructions);
document.getElementById('checkBalance').addEventListener('click', () => checkBalance());
document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('paymentModal').classList.remove('show');
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
    }
});

// Initialize
loadServiceInfo();
loadStats();
setInterval(loadStats, 30000); // Refresh every 30 seconds

// Auto-connect if MetaMask is available
if (typeof window.ethereum !== 'undefined') {
    ethereum.request({ method: 'eth_accounts' }).then(accounts => {
        if (accounts.length > 0) {
            userWalletAddress = accounts[0];
            document.getElementById('walletAddress').value = userWalletAddress;
            checkPendingPayment(userWalletAddress);
        }
    });
}
