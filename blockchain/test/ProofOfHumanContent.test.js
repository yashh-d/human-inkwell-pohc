const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ProofOfHumanContent", function () {
  let proofOfHumanContent;
  let mockWorldID;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    // Get the ContractFactory and Signers
    [owner, addr1, addr2] = await ethers.getSigners();

    // Deploy a mock WorldID contract
    const MockWorldIDFactory = await ethers.getContractFactory("MockWorldID");
    mockWorldID = await MockWorldIDFactory.deploy();
    await mockWorldID.waitForDeployment();

    // Deploy the ProofOfHumanContent contract (simplified version)
    const ProofOfHumanContent = await ethers.getContractFactory("ProofOfHumanContentSimple");
    const appId = "app_staging_12345";
    const action = "human-content-proof";
    proofOfHumanContent = await ProofOfHumanContent.deploy(
      await mockWorldID.getAddress(),
      appId,
      action
    );
    await proofOfHumanContent.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await proofOfHumanContent.owner()).to.equal(owner.address);
    });

    it("Should set the correct action ID", async function () {
      const contractInfo = await proofOfHumanContent.getContractInfo();
      expect(contractInfo.currentActionId).to.equal(1); // Group ID is 1 for Orb
    });

    it("Should start with zero proofs", async function () {
      expect(await proofOfHumanContent.totalProofs()).to.equal(0);
    });
  });

  describe("Proof Submission", function () {
    const contentHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const humanSignatureHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const keystrokeCount = 42;
    const typingSpeed = 1500; // 1.5 chars/sec * 1000
    const root = ethers.getBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
    const nullifierHash = ethers.getBigInt("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    const proof = [
      ethers.getBigInt("0x1111111111111111111111111111111111111111111111111111111111111111"),
      ethers.getBigInt("0x2222222222222222222222222222222222222222222222222222222222222222"),
      ethers.getBigInt("0x3333333333333333333333333333333333333333333333333333333333333333"),
      ethers.getBigInt("0x4444444444444444444444444444444444444444444444444444444444444444"),
      ethers.getBigInt("0x5555555555555555555555555555555555555555555555555555555555555555"),
      ethers.getBigInt("0x6666666666666666666666666666666666666666666666666666666666666666"),
      ethers.getBigInt("0x7777777777777777777777777777777777777777777777777777777777777777"),
      ethers.getBigInt("0x8888888888888888888888888888888888888888888888888888888888888888")
    ];

    it("Should submit proof successfully", async function () {
      await expect(proofOfHumanContent.connect(addr1).submitProof(
        contentHash,
        humanSignatureHash,
        keystrokeCount,
        typingSpeed,
        root,
        nullifierHash,
        proof
      )).to.emit(proofOfHumanContent, "ProofSubmitted");

      expect(await proofOfHumanContent.totalProofs()).to.equal(1);
    });

    it("Should store proof data correctly", async function () {
      await proofOfHumanContent.connect(addr1).submitProof(
        contentHash,
        humanSignatureHash,
        keystrokeCount,
        typingSpeed,
        root,
        nullifierHash,
        proof
      );

      const storedProof = await proofOfHumanContent.getProofByContent(contentHash);
      expect(storedProof.author).to.equal(addr1.address);
      expect(storedProof.contentHash).to.equal(contentHash);
      expect(storedProof.humanSignatureHash).to.equal(humanSignatureHash);
      expect(storedProof.keystrokeCount).to.equal(keystrokeCount);
      expect(storedProof.typingSpeed).to.equal(typingSpeed);
      expect(storedProof.exists).to.equal(true);
    });

    it("Should prevent duplicate content", async function () {
      await proofOfHumanContent.connect(addr1).submitProof(
        contentHash,
        humanSignatureHash,
        keystrokeCount,
        typingSpeed,
        root,
        nullifierHash,
        proof
      );

      await expect(proofOfHumanContent.connect(addr2).submitProof(
        contentHash,
        "0x9999999999999999999999999999999999999999999999999999999999999999",
        keystrokeCount,
        typingSpeed,
        root,
        ethers.getBigInt("0x9999999999999999999999999999999999999999999999999999999999999999"),
        proof
      )).to.be.revertedWithCustomError(proofOfHumanContent, "ContentAlreadyExists");
    });

    it("Should prevent duplicate human signatures", async function () {
      await proofOfHumanContent.connect(addr1).submitProof(
        contentHash,
        humanSignatureHash,
        keystrokeCount,
        typingSpeed,
        root,
        nullifierHash,
        proof
      );

      await expect(proofOfHumanContent.connect(addr2).submitProof(
        "0x9999999999999999999999999999999999999999999999999999999999999999",
        humanSignatureHash, // Same signature
        keystrokeCount,
        typingSpeed,
        root,
        ethers.getBigInt("0x9999999999999999999999999999999999999999999999999999999999999999"),
        proof
      )).to.be.revertedWithCustomError(proofOfHumanContent, "SignatureAlreadyUsed");
    });

    it("Should revert with empty parameters", async function () {
      await expect(proofOfHumanContent.connect(addr1).submitProof(
        "", // Empty content hash
        humanSignatureHash,
        keystrokeCount,
        typingSpeed,
        root,
        nullifierHash,
        proof
      )).to.be.revertedWithCustomError(proofOfHumanContent, "InvalidParameters");
    });
  });

  describe("Content Queries", function () {
    const contentHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const humanSignatureHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const keystrokeCount = 42;
    const typingSpeed = 1500;
    const root = ethers.getBigInt("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
    const nullifierHash = ethers.getBigInt("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    const proof = [
      ethers.getBigInt("0x1111111111111111111111111111111111111111111111111111111111111111"),
      ethers.getBigInt("0x2222222222222222222222222222222222222222222222222222222222222222"),
      ethers.getBigInt("0x3333333333333333333333333333333333333333333333333333333333333333"),
      ethers.getBigInt("0x4444444444444444444444444444444444444444444444444444444444444444"),
      ethers.getBigInt("0x5555555555555555555555555555555555555555555555555555555555555555"),
      ethers.getBigInt("0x6666666666666666666666666666666666666666666666666666666666666666"),
      ethers.getBigInt("0x7777777777777777777777777777777777777777777777777777777777777777"),
      ethers.getBigInt("0x8888888888888888888888888888888888888888888888888888888888888888")
    ];

    beforeEach(async function () {
      await proofOfHumanContent.connect(addr1).submitProof(
        contentHash,
        humanSignatureHash,
        keystrokeCount,
        typingSpeed,
        root,
        nullifierHash,
        proof
      );
    });

    it("Should check content existence", async function () {
      expect(await proofOfHumanContent.contentExists(contentHash)).to.equal(true);
      expect(await proofOfHumanContent.contentExists("0x9999999999999999999999999999999999999999999999999999999999999999")).to.equal(false);
    });

    it("Should check signature existence", async function () {
      expect(await proofOfHumanContent.signatureExists(humanSignatureHash)).to.equal(true);
      expect(await proofOfHumanContent.signatureExists("0x9999999999999999999999999999999999999999999999999999999999999999")).to.equal(false);
    });

    it("Should get content by author", async function () {
      const authorContent = await proofOfHumanContent.getContentByAuthor(addr1.address);
      expect(authorContent.length).to.equal(1);
      expect(authorContent[0]).to.equal(contentHash);
    });

    it("Should verify content authenticity", async function () {
      const [isAuthentic, actualAuthor, timestamp] = await proofOfHumanContent.verifyContent(
        contentHash,
        addr1.address
      );
      expect(isAuthentic).to.equal(true);
      expect(actualAuthor).to.equal(addr1.address);
      expect(timestamp).to.be.gt(0);
    });

    it("Should return false for invalid content verification", async function () {
      const [isAuthentic, actualAuthor, timestamp] = await proofOfHumanContent.verifyContent(
        "0x9999999999999999999999999999999999999999999999999999999999999999",
        addr1.address
      );
      expect(isAuthentic).to.equal(false);
      expect(actualAuthor).to.equal(ethers.ZeroAddress);
      expect(timestamp).to.equal(0);
    });
  });

  describe("Contract Info", function () {
    it("Should return correct contract info", async function () {
      const contractInfo = await proofOfHumanContent.getContractInfo();
      expect(contractInfo.worldIdAddress).to.equal(await mockWorldID.getAddress());
      expect(contractInfo.currentActionId).to.equal(1); // Group ID is 1 for Orb
      expect(contractInfo.totalProofCount).to.equal(0);
    });
  });
}); 