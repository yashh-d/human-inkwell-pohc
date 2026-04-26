const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HumanContentLedger", function () {
  let humanContentLedger;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    // Get the ContractFactory and Signers
    const HumanContentLedger = await ethers.getContractFactory("HumanContentLedger");
    [owner, addr1, addr2] = await ethers.getSigners();

    // Deploy the contract
    humanContentLedger = await HumanContentLedger.deploy();
    await humanContentLedger.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await humanContentLedger.owner()).to.equal(owner.address);
    });

    it("Should start with zero entries", async function () {
      expect(await humanContentLedger.getTotalEntries()).to.equal(0);
    });
  });

  describe("Content Storage", function () {
    it("Should store content without World ID", async function () {
      const contentHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const signatureHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      const keystrokeCount = 42;
      const typingSpeed = 1500; // 1.5 chars/sec * 1000

      await humanContentLedger.connect(addr1).storeContent(
        contentHash,
        signatureHash,
        keystrokeCount,
        typingSpeed
      );

      const entry = await humanContentLedger.getContentEntry(1);
      expect(entry.contentHash).to.equal(contentHash);
      expect(entry.humanSignatureHash).to.equal(signatureHash);
      expect(entry.author).to.equal(addr1.address);
      expect(entry.keystrokeCount).to.equal(keystrokeCount);
      expect(entry.typingSpeed).to.equal(typingSpeed);
      expect(entry.isVerified).to.equal(false);
    });

    it("Should store verified content with World ID", async function () {
      const contentHash = "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const signatureHash = "0xbbcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      const worldIdNullifier = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
      const keystrokeCount = 55;
      const typingSpeed = 2000; // 2.0 chars/sec * 1000

      await humanContentLedger.connect(addr1).storeVerifiedContent(
        contentHash,
        signatureHash,
        worldIdNullifier,
        keystrokeCount,
        typingSpeed
      );

      const entry = await humanContentLedger.getContentEntry(1);
      expect(entry.contentHash).to.equal(contentHash);
      expect(entry.humanSignatureHash).to.equal(signatureHash);
      expect(entry.worldIdNullifier).to.equal(worldIdNullifier);
      expect(entry.author).to.equal(addr1.address);
      expect(entry.isVerified).to.equal(true);
    });

    it("Should prevent duplicate content", async function () {
      const contentHash = "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const signatureHash1 = "0xcc1def1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      const signatureHash2 = "0xcc2def1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

      await humanContentLedger.connect(addr1).storeContent(
        contentHash,
        signatureHash1,
        42,
        1500
      );

      await expect(
        humanContentLedger.connect(addr2).storeContent(
          contentHash,
          signatureHash2,
          42,
          1500
        )
      ).to.be.revertedWith("Content already exists");
    });

    it("Should prevent duplicate human signatures", async function () {
      const contentHash1 = "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const contentHash2 = "0x4334567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const signatureHash = "0xdd1def1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

      await humanContentLedger.connect(addr1).storeContent(
        contentHash1,
        signatureHash,
        42,
        1500
      );

      await expect(
        humanContentLedger.connect(addr2).storeContent(
          contentHash2,
          signatureHash,
          42,
          1500
        )
      ).to.be.revertedWith("Human signature already used");
    });
  });

  describe("Content Retrieval", function () {
    beforeEach(async function () {
      // Store some test content
      await humanContentLedger.connect(addr1).storeContent(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
        "0xaaaa111111111111111111111111111111111111111111111111111111111111",
        42,
        1500
      );
    });

    it("Should retrieve content by hash", async function () {
      const contentHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
      const entryId = await humanContentLedger.getEntryIdByContentHash(contentHash);
      expect(entryId).to.equal(1);
    });

    it("Should retrieve content by signature hash", async function () {
      const signatureHash = "0xaaaa111111111111111111111111111111111111111111111111111111111111";
      const entryId = await humanContentLedger.getEntryIdBySignatureHash(signatureHash);
      expect(entryId).to.equal(1);
    });

    it("Should get entries by author", async function () {
      const entries = await humanContentLedger.getEntriesByAuthor(addr1.address);
      expect(entries.length).to.equal(1);
      expect(entries[0]).to.equal(1);
    });

    it("Should check content existence", async function () {
      const contentHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
      const exists = await humanContentLedger.contentExists(contentHash);
      expect(exists).to.equal(true);

      const nonExistent = await humanContentLedger.contentExists("0x9999999999999999999999999999999999999999999999999999999999999999");
      expect(nonExistent).to.equal(false);
    });
  });

  describe("Events", function () {
    it("Should emit ContentStored event", async function () {
      const contentHash = "0x5555555555555555555555555555555555555555555555555555555555555555";
      const signatureHash = "0xeeee555555555555555555555555555555555555555555555555555555555555";

      await expect(
        humanContentLedger.connect(addr1).storeContent(
          contentHash,
          signatureHash,
          42,
          1500
        )
      )
        .to.emit(humanContentLedger, "ContentStored")
        .withArgs(1, addr1.address, contentHash, signatureHash, false);
    });

    it("Should emit ContentStored and WorldIdVerified events for verified content", async function () {
      const contentHash = "0x6666666666666666666666666666666666666666666666666666666666666666";
      const signatureHash = "0xffff666666666666666666666666666666666666666666666666666666666666";
      const worldIdNullifier = "0x7777777777777777777777777777777777777777777777777777777777777777";

      await expect(
        humanContentLedger.connect(addr1).storeVerifiedContent(
          contentHash,
          signatureHash,
          worldIdNullifier,
          42,
          1500
        )
      )
        .to.emit(humanContentLedger, "ContentStored")
        .withArgs(1, addr1.address, contentHash, signatureHash, true)
        .and.to.emit(humanContentLedger, "WorldIdVerified")
        .withArgs(1, worldIdNullifier);
    });
  });
}); 