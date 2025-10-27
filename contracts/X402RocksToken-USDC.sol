// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title X402RocksToken
 * @dev ERC20 token with USDC payment on Base mainnet
 */
contract X402RocksToken is ERC20, Ownable, ReentrancyGuard {
    
    // Constants
    uint256 public constant TOKENS_PER_MINT = 50_000 * 10**18; // 50,000 tokens
    uint256 public constant MAX_MINTS = 40_000;
    uint256 public constant MAX_SUPPLY = 2_000_000_000 * 10**18; // 2 billion
    uint256 public constant USDC_PRICE = 1_000_000; // $1.00 USDC (6 decimals)
    
    // USDC contract on Base mainnet
    IERC20 public immutable USDC;
    
    // State
    uint256 public totalMints;
    address public paymentReceiver;
    
    // Tracking
    mapping(address => uint256) public mintsPerAddress;
    
    // Events
    event TokensMinted(
        address indexed recipient,
        uint256 tokenAmount,
        uint256 usdcPaid,
        uint256 mintNumber
    );
    event PaymentReceiverUpdated(address oldReceiver, address newReceiver);
    
    /**
     * @dev Constructor
     * @param _usdcAddress USDC contract address on Base (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
     * @param _paymentReceiver Address to receive USDC payments
     */
    constructor(
        address _usdcAddress,
        address _paymentReceiver
    ) ERC20("x402rocks", "X402") Ownable(msg.sender) {
        require(_usdcAddress != address(0), "Invalid USDC address");
        require(_paymentReceiver != address(0), "Invalid payment receiver");
        
        USDC = IERC20(_usdcAddress);
        paymentReceiver = _paymentReceiver;
    }
    
    /**
     * @dev Mint tokens by paying USDC directly
     * User must approve this contract to spend their USDC first
     * This is the ONE-CLICK MINT function
     */
    function mint() external nonReentrant {
        require(totalMints < MAX_MINTS, "Max mints reached");
        require(totalSupply() + TOKENS_PER_MINT <= MAX_SUPPLY, "Max supply exceeded");
        
        // Transfer USDC from user to payment receiver
        bool success = USDC.transferFrom(msg.sender, paymentReceiver, USDC_PRICE);
        require(success, "USDC transfer failed");
        
        // Mint tokens to user
        totalMints++;
        mintsPerAddress[msg.sender]++;
        _mint(msg.sender, TOKENS_PER_MINT);
        
        emit TokensMinted(msg.sender, TOKENS_PER_MINT, USDC_PRICE, totalMints);
    }
    
    /**
     * @dev Mint to specific address (backend calls this after verifying off-chain payment)
     */
    function mintTo(address recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        require(totalMints < MAX_MINTS, "Max mints reached");
        require(totalSupply() + TOKENS_PER_MINT <= MAX_SUPPLY, "Max supply exceeded");
        
        totalMints++;
        mintsPerAddress[recipient]++;
        _mint(recipient, TOKENS_PER_MINT);
        
        emit TokensMinted(recipient, TOKENS_PER_MINT, 0, totalMints);
    }
    
    /**
     * @dev Batch mint to multiple addresses
     */
    function batchMintTo(address[] calldata recipients) external onlyOwner nonReentrant {
        uint256 numRecipients = recipients.length;
        require(totalMints + numRecipients <= MAX_MINTS, "Would exceed max mints");
        require(
            totalSupply() + (TOKENS_PER_MINT * numRecipients) <= MAX_SUPPLY,
            "Would exceed max supply"
        );
        
        for (uint256 i = 0; i < numRecipients; i++) {
            require(recipients[i] != address(0), "Invalid recipient");
            
            totalMints++;
            mintsPerAddress[recipients[i]]++;
            _mint(recipients[i], TOKENS_PER_MINT);
            
            emit TokensMinted(recipients[i], TOKENS_PER_MINT, 0, totalMints);
        }
    }
    
    /**
     * @dev Update payment receiver
     */
    function updatePaymentReceiver(address _newReceiver) external onlyOwner {
        require(_newReceiver != address(0), "Invalid receiver");
        address oldReceiver = paymentReceiver;
        paymentReceiver = _newReceiver;
        emit PaymentReceiverUpdated(oldReceiver, _newReceiver);
    }
    
    /**
     * @dev Get remaining mints
     */
    function remainingMints() external view returns (uint256) {
        return MAX_MINTS - totalMints;
    }
    
    /**
     * @dev Get USDC price (for display)
     */
    function getPrice() external pure returns (uint256) {
        return USDC_PRICE;
    }
    
    /**
     * @dev Get price in dollars
     */
    function getPriceUSD() external pure returns (string memory) {
        return "1.00";
    }
}
