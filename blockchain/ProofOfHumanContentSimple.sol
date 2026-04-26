// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IWorldID {
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view;
}

/**
 * @title ProofOfHumanContentSimple
 * @dev Simplified version for testing with official World ID integration
 * @notice This contract stores human-verified content with biometric signatures
 */
contract ProofOfHumanContentSimple {
    
    // World ID integration (official)
    IWorldID internal immutable worldId;
    uint256 internal immutable externalNullifierHash;
    uint256 internal immutable groupId = 1; // Orb credentials only
    
    address public owner;
    
    // Mapping to store used nullifiers for sybil resistance
    mapping(uint256 => bool) public nullifierHashes;
    
    // Mapping from content hash to nullifier hash (prevents duplicate content)
    mapping(string => uint256) public contentToNullifier;
    
    // Mapping from nullifier hash to proof data
    mapping(uint256 => ProofData) public proofs;
    
    // Mapping from author address to their content hashes
    mapping(address => string[]) public authorToContent;
    
    // Mapping from human signature hash to content hash (prevents signature reuse)
    mapping(string => string) public signatureToContent;
    
    // Array of all content hashes for enumeration
    string[] public allContentHashes;
    
    // Counter for total proofs
    uint256 public totalProofs;
    
    struct ProofData {
        address author;
        uint256 timestamp;
        string contentHash;
        string humanSignatureHash;
        uint256 keystrokeCount;
        uint256 typingSpeed; // Characters per second (scaled by 1000)
        bool exists;
    }
    
    // Events
    event ProofSubmitted(
        address indexed author,
        string indexed contentHash,
        string humanSignatureHash,
        uint256 nullifierHash,
        uint256 keystrokeCount,
        uint256 typingSpeed
    );
    
    // Custom errors
    error InvalidNullifier();
    error InvalidWorldIdProof();
    error ContentAlreadyExists();
    error SignatureAlreadyUsed();
    error InvalidParameters();
    error ContentNotFound();
    error OnlyOwner();
    
    /// @dev Helper function to convert bytes to field element
    function hashToField(bytes memory value) internal pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
    }
    
    constructor(
        address _worldIdContract,
        string memory _appId,
        string memory _action
    ) {
        worldId = IWorldID(_worldIdContract);
        externalNullifierHash = hashToField(abi.encodePacked(hashToField(abi.encodePacked(_appId)), _action));
        owner = msg.sender;
    }
    
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }
    
    /**
     * @dev Submit a proof of human content with World ID verification
     * @param _contentHash Hash of the typed content
     * @param _humanSignatureHash Hash of biometric keystroke signature
     * @param _keystrokeCount Number of keystrokes captured
     * @param _typingSpeed Typing speed in characters per second (scaled by 1000)
     * @param _root World ID merkle root
     * @param _nullifierHash World ID nullifier hash
     * @param _proof World ID zero-knowledge proof
     */
    function submitProof(
        string memory _contentHash,
        string memory _humanSignatureHash,
        uint256 _keystrokeCount,
        uint256 _typingSpeed,
        uint256 _root,
        uint256 _nullifierHash,
        uint256[8] memory _proof
    ) external {
        // Validate parameters
        if (bytes(_contentHash).length == 0 || bytes(_humanSignatureHash).length == 0) {
            revert InvalidParameters();
        }
        
        // Check for sybil resistance - make sure this person hasn't done this before
        if (nullifierHashes[_nullifierHash]) revert InvalidNullifier();
        
        // Check if content already exists
        if (contentToNullifier[_contentHash] != 0) {
            revert ContentAlreadyExists();
        }
        
        // Check if human signature already used
        if (bytes(signatureToContent[_humanSignatureHash]).length > 0) {
            revert SignatureAlreadyUsed();
        }
        
        // Verify World ID proof using official method
        uint256 signalHash = hashToField(abi.encodePacked(msg.sender));
        
        worldId.verifyProof(
            _root,
            groupId,
            signalHash,
            _nullifierHash,
            externalNullifierHash,
            _proof
        );
        
        // Record the user has done this, so they can't do it again (proof of uniqueness)
        nullifierHashes[_nullifierHash] = true;
        
        // Store proof data
        proofs[_nullifierHash] = ProofData({
            author: msg.sender,
            timestamp: block.timestamp,
            contentHash: _contentHash,
            humanSignatureHash: _humanSignatureHash,
            keystrokeCount: _keystrokeCount,
            typingSpeed: _typingSpeed,
            exists: true
        });
        
        // Update mappings
        contentToNullifier[_contentHash] = _nullifierHash;
        signatureToContent[_humanSignatureHash] = _contentHash;
        authorToContent[msg.sender].push(_contentHash);
        allContentHashes.push(_contentHash);
        
        // Increment counter
        totalProofs++;
        
        // Emit event
        emit ProofSubmitted(
            msg.sender,
            _contentHash,
            _humanSignatureHash,
            _nullifierHash,
            _keystrokeCount,
            _typingSpeed
        );
    }
    
    /**
     * @dev Get proof data by content hash
     * @param _contentHash Hash of the content
     * @return ProofData struct containing all proof information
     */
    function getProofByContent(string memory _contentHash) external view returns (ProofData memory) {
        uint256 nullifierHash = contentToNullifier[_contentHash];
        if (nullifierHash == 0) {
            revert ContentNotFound();
        }
        return proofs[nullifierHash];
    }
    
    /**
     * @dev Get proof data by nullifier hash
     * @param _nullifierHash World ID nullifier hash
     * @return ProofData struct containing all proof information
     */
    function getProofByNullifier(uint256 _nullifierHash) external view returns (ProofData memory) {
        ProofData memory proof = proofs[_nullifierHash];
        if (!proof.exists) {
            revert ContentNotFound();
        }
        return proof;
    }
    
    /**
     * @dev Check if content exists
     * @param _contentHash Hash of the content
     * @return bool indicating if content exists
     */
    function contentExists(string memory _contentHash) external view returns (bool) {
        return contentToNullifier[_contentHash] != 0;
    }
    
    /**
     * @dev Check if human signature has been used
     * @param _humanSignatureHash Hash of biometric signature
     * @return bool indicating if signature has been used
     */
    function signatureExists(string memory _humanSignatureHash) external view returns (bool) {
        return bytes(signatureToContent[_humanSignatureHash]).length > 0;
    }
    
    /**
     * @dev Get all content hashes by author
     * @param _author Address of the author
     * @return Array of content hashes
     */
    function getContentByAuthor(address _author) external view returns (string[] memory) {
        return authorToContent[_author];
    }
    
    /**
     * @dev Get total number of content hashes
     * @return Total number of unique content pieces
     */
    function getTotalContent() external view returns (uint256) {
        return allContentHashes.length;
    }
    
    /**
     * @dev Get content hash by index
     * @param _index Index in the allContentHashes array
     * @return Content hash at the specified index
     */
    function getContentByIndex(uint256 _index) external view returns (string memory) {
        require(_index < allContentHashes.length, "Index out of bounds");
        return allContentHashes[_index];
    }
    
    /**
     * @dev Get contract info
     * @return worldIdAddress Address of World ID contract
     * @return currentActionId Current action ID
     * @return totalProofCount Total number of proofs
     */
    function getContractInfo() external view returns (
        address worldIdAddress,
        uint256 currentActionId,
        uint256 totalProofCount
    ) {
        return (
            address(worldId),
            groupId, // Action ID is groupId for Orb
            totalProofs
        );
    }
    
    /**
     * @dev Verify content authenticity
     * @param _contentHash Hash of the content to verify
     * @param _expectedAuthor Expected author address
     * @return isAuthentic Whether the content is authentic
     * @return actualAuthor The actual author address
     * @return timestamp When the content was submitted
     */
    function verifyContent(
        string memory _contentHash,
        address _expectedAuthor
    ) external view returns (
        bool isAuthentic,
        address actualAuthor,
        uint256 timestamp
    ) {
        uint256 nullifierHash = contentToNullifier[_contentHash];
        if (nullifierHash == 0) {
            return (false, address(0), 0);
        }
        
        ProofData memory proof = proofs[nullifierHash];
        return (
            proof.author == _expectedAuthor,
            proof.author,
            proof.timestamp
        );
    }
} 