// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IWorldID} from "@worldcoin/world-id-protocol/contracts/interfaces/IWorldID.sol";

/**
 * @title ProofOfHumanContent
 * @dev Master contract for storing human-verified content with biometric signatures
 * @notice This contract combines World ID proof-of-humanness with biometric keystroke analysis
 */
contract ProofOfHumanContent is Ownable {
    
    // World ID integration
    IWorldID public worldIdContract;
    uint256 public immutable actionId;
    
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
    
    event ActionIdUpdated(uint256 newActionId);
    
    // Custom errors
    error InvalidWorldIdProof();
    error ContentAlreadyExists();
    error SignatureAlreadyUsed();
    error InvalidParameters();
    error ContentNotFound();
    
    constructor(
        address _worldIdContract,
        uint256 _actionId
    ) Ownable(msg.sender) {
        worldIdContract = IWorldID(_worldIdContract);
        actionId = _actionId;
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
        
        // Check if content already exists
        if (contentToNullifier[_contentHash] != 0) {
            revert ContentAlreadyExists();
        }
        
        // Check if human signature already used
        if (bytes(signatureToContent[_humanSignatureHash]).length > 0) {
            revert SignatureAlreadyUsed();
        }
        
        // Verify World ID proof using content hash as signal
        try worldIdContract.verifyProof(
            _root,
            actionId,
            abi.encodePacked(_contentHash).hashToField(),
            _nullifierHash,
            _proof
        ) {
            // World ID verification successful
        } catch {
            revert InvalidWorldIdProof();
        }
        
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
     * @dev Update action ID (owner only)
     * @param _newActionId New action ID
     */
    function updateActionId(uint256 _newActionId) external onlyOwner {
        // Note: actionId is immutable, so this would require a new deployment
        // This function is here for documentation purposes
        emit ActionIdUpdated(_newActionId);
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
            address(worldIdContract),
            actionId,
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

// Extension to support bytes to field conversion for World ID
library BytesToField {
    function hashToField(bytes memory data) internal pure returns (uint256) {
        return uint256(keccak256(data)) >> 8; // Reduce to 248 bits for field element
    }
}

// Add the extension to bytes
library BytesExtension {
    function hashToField(bytes memory data) internal pure returns (uint256) {
        return BytesToField.hashToField(data);
    }
} 