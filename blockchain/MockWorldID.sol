// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockWorldID
 * @dev Mock World ID contract for testing purposes
 */
contract MockWorldID {
    
    mapping(uint256 => bool) public usedNullifiers;
    
    event ProofVerified(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash
    );
    
    /**
     * @dev Mock verify proof function - matches official IWorldID interface
     * @param root Merkle root
     * @param groupId Group identifier (1 for Orb credentials)
     * @param signalHash Hash of the signal used in proof
     * @param nullifierHash Nullifier hash to prevent double spending
     * @param externalNullifierHash Hash of external nullifier
     * @param proof Zero-knowledge proof (not used in mock)
     */
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view {
        // Mock validation - in real contract this would verify the zero-knowledge proof
        require(root != 0, "Invalid root");
        require(groupId == 1, "Invalid group ID - only Orb credentials supported");
        require(signalHash != 0, "Invalid signal hash");
        require(nullifierHash != 0, "Invalid nullifier hash");
        require(externalNullifierHash != 0, "Invalid external nullifier hash");
        require(!usedNullifiers[nullifierHash], "Nullifier already used");
        
        // Note: In a real deployment, this would mark the nullifier as used
        // But in a view function, we can't modify state
        // The actual contract will handle nullifier tracking
    }
    
    /**
     * @dev Check if nullifier has been used
     * @param nullifierHash The nullifier to check
     * @return bool indicating if nullifier has been used
     */
    function isNullifierUsed(uint256 nullifierHash) external view returns (bool) {
        return usedNullifiers[nullifierHash];
    }
    
    /**
     * @dev Mock function to mark nullifier as used (for testing)
     * @param nullifierHash The nullifier to mark as used
     */
    function markNullifierUsed(uint256 nullifierHash) external {
        usedNullifiers[nullifierHash] = true;
    }
} 