// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title HumanContentLedger
 * @dev A smart contract for storing human-verified content with biometric signatures
 * @notice This contract combines World ID proof-of-humanness with biometric keystroke analysis
 */
contract HumanContentLedger is EIP712 {
    
    // Struct to store human content entries
    struct ContentEntry {
        string contentHash;           // SHA-256 hash of the typed content
        string humanSignatureHash;    // SHA-256 hash of biometric signature
        string worldIdNullifier;      // World ID nullifier hash (optional)
        address author;               // Address of the content author
        uint256 timestamp;            // Block timestamp when content was stored
        uint256 keystrokeCount;       // Number of keystrokes captured
        uint256 typingSpeed;          // Characters per second (scaled by 1000)
        bool isVerified;              // Whether World ID verification was used
    }
    
    // Mapping from entry ID to content entry
    mapping(uint256 => ContentEntry) public contentEntries;
    
    // Mapping from content hash to entry ID (prevent duplicates)
    mapping(string => uint256) public contentHashToId;
    
    // Mapping from human signature hash to entry ID (prevent duplicate signatures)
    mapping(string => uint256) public signatureHashToId;
    
    // Mapping from World ID nullifier to entry ID (prevent reuse)
    mapping(string => uint256) public nullifierToId;
    
    // Mapping from author address to their entry IDs
    mapping(address => uint256[]) public authorToEntries;
    
    // Counter for generating unique entry IDs
    uint256 private nextEntryId = 1;
    
    // Contract owner
    address public owner;

    // EIP-712 Meta-Transactions
    mapping(address => uint256) public nonces;
    bytes32 private constant STORE_TYPEHASH = keccak256("StoreContent(string contentHash,string humanSignatureHash,uint256 keystrokeCount,uint256 typingSpeed,uint256 nonce)");
    
    
    // Events
    event ContentStored(
        uint256 indexed entryId,
        address indexed author,
        string contentHash,
        string humanSignatureHash,
        bool isVerified
    );
    
    event WorldIdVerified(
        uint256 indexed entryId,
        string worldIdNullifier
    );
    
    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    modifier validHashes(string memory _contentHash, string memory _humanSignatureHash) {
        require(bytes(_contentHash).length > 0, "Content hash cannot be empty");
        require(bytes(_humanSignatureHash).length > 0, "Human signature hash cannot be empty");
        require(contentHashToId[_contentHash] == 0, "Content already exists");
        require(signatureHashToId[_humanSignatureHash] == 0, "Human signature already used");
        _;
    }
    
    constructor() EIP712("HumanContentLedger", "1") {
        owner = msg.sender;
    }
    
    /**
     * @dev Store human-verified content without World ID
     * @param _contentHash SHA-256 hash of the typed content
     * @param _humanSignatureHash SHA-256 hash of biometric signature
     * @param _keystrokeCount Number of keystrokes captured
     * @param _typingSpeed Characters per second (scaled by 1000)
     */
    function storeContent(
        string memory _contentHash,
        string memory _humanSignatureHash,
        uint256 _keystrokeCount,
        uint256 _typingSpeed
    ) external validHashes(_contentHash, _humanSignatureHash) {
        _storeContentInternal(_contentHash, _humanSignatureHash, _keystrokeCount, _typingSpeed, msg.sender);
    }
    
    /**
     * @dev Core internal logic for storing content, to be used by both direct and gasless calls
     */
    function _storeContentInternal(
        string memory _contentHash,
        string memory _humanSignatureHash,
        uint256 _keystrokeCount,
        uint256 _typingSpeed,
        address _author
    ) internal {
        uint256 entryId = nextEntryId++;
        
        contentEntries[entryId] = ContentEntry({
            contentHash: _contentHash,
            humanSignatureHash: _humanSignatureHash,
            worldIdNullifier: "",
            author: _author,
            timestamp: block.timestamp,
            keystrokeCount: _keystrokeCount,
            typingSpeed: _typingSpeed,
            isVerified: false
        });
        
        // Update mappings
        contentHashToId[_contentHash] = entryId;
        signatureHashToId[_humanSignatureHash] = entryId;
        authorToEntries[_author].push(entryId);
        
        emit ContentStored(entryId, _author, _contentHash, _humanSignatureHash, false);
    }

    /**
     * @dev Gasless version of storeContent using EIP-712 signatures. Used by backend relayers.
     */
    function storeContentGasless(
        string memory _contentHash,
        string memory _humanSignatureHash,
        uint256 _keystrokeCount,
        uint256 _typingSpeed,
        address _author,
        uint8 v, bytes32 r, bytes32 s
    ) external validHashes(_contentHash, _humanSignatureHash) {
        
        bytes32 structHash = keccak256(abi.encode(
            STORE_TYPEHASH,
            keccak256(bytes(_contentHash)),
            keccak256(bytes(_humanSignatureHash)),
            _keystrokeCount,
            _typingSpeed,
            nonces[_author]++
        ));
        
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, v, r, s);
        
        require(signer == _author, "Invalid EIP-712 signature");
        
        _storeContentInternal(_contentHash, _humanSignatureHash, _keystrokeCount, _typingSpeed, _author);
    }

    /**
     * @dev Store human-verified content with World ID verification
     * @param _contentHash SHA-256 hash of the typed content
     * @param _humanSignatureHash SHA-256 hash of biometric signature
     * @param _worldIdNullifier World ID nullifier hash
     * @param _keystrokeCount Number of keystrokes captured
     * @param _typingSpeed Characters per second (scaled by 1000)
     */
    function storeVerifiedContent(
        string memory _contentHash,
        string memory _humanSignatureHash,
        string memory _worldIdNullifier,
        uint256 _keystrokeCount,
        uint256 _typingSpeed
    ) external validHashes(_contentHash, _humanSignatureHash) {
        
        require(bytes(_worldIdNullifier).length > 0, "World ID nullifier cannot be empty");
        require(nullifierToId[_worldIdNullifier] == 0, "World ID nullifier already used");
        
        uint256 entryId = nextEntryId++;
        
        contentEntries[entryId] = ContentEntry({
            contentHash: _contentHash,
            humanSignatureHash: _humanSignatureHash,
            worldIdNullifier: _worldIdNullifier,
            author: msg.sender,
            timestamp: block.timestamp,
            keystrokeCount: _keystrokeCount,
            typingSpeed: _typingSpeed,
            isVerified: true
        });
        
        // Update mappings
        contentHashToId[_contentHash] = entryId;
        signatureHashToId[_humanSignatureHash] = entryId;
        nullifierToId[_worldIdNullifier] = entryId;
        authorToEntries[msg.sender].push(entryId);
        
        emit ContentStored(entryId, msg.sender, _contentHash, _humanSignatureHash, true);
        emit WorldIdVerified(entryId, _worldIdNullifier);
    }
    
    /**
     * @dev Get content entry by ID
     * @param _entryId The entry ID to retrieve
     * @return ContentEntry struct
     */
    function getContentEntry(uint256 _entryId) external view returns (ContentEntry memory) {
        require(_entryId > 0 && _entryId < nextEntryId, "Entry does not exist");
        return contentEntries[_entryId];
    }
    
    /**
     * @dev Get entry ID by content hash
     * @param _contentHash The content hash to look up
     * @return Entry ID (0 if not found)
     */
    function getEntryIdByContentHash(string memory _contentHash) external view returns (uint256) {
        return contentHashToId[_contentHash];
    }
    
    /**
     * @dev Get entry ID by human signature hash
     * @param _humanSignatureHash The human signature hash to look up
     * @return Entry ID (0 if not found)
     */
    function getEntryIdBySignatureHash(string memory _humanSignatureHash) external view returns (uint256) {
        return signatureHashToId[_humanSignatureHash];
    }
    
    /**
     * @dev Get all entry IDs for a specific author
     * @param _author The author address
     * @return Array of entry IDs
     */
    function getEntriesByAuthor(address _author) external view returns (uint256[] memory) {
        return authorToEntries[_author];
    }
    
    /**
     * @dev Get the total number of content entries
     * @return Total count of entries
     */
    function getTotalEntries() external view returns (uint256) {
        return nextEntryId - 1;
    }
    
    /**
     * @dev Verify if a content hash exists
     * @param _contentHash The content hash to check
     * @return Whether the content exists
     */
    function contentExists(string memory _contentHash) external view returns (bool) {
        return contentHashToId[_contentHash] != 0;
    }
    
    /**
     * @dev Verify if a human signature hash has been used
     * @param _humanSignatureHash The human signature hash to check
     * @return Whether the signature has been used
     */
    function signatureExists(string memory _humanSignatureHash) external view returns (bool) {
        return signatureHashToId[_humanSignatureHash] != 0;
    }
    
    /**
     * @dev Emergency function to pause contract (owner only)
     */
    function pause() external onlyOwner {
        // Implementation for pausing contract functionality
        // This is a placeholder for emergency scenarios
    }
} 