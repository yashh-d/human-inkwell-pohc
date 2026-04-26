const hre = require("hardhat");

async function main() {
  console.log("🧪 Testing Human Content Ledger interaction...");
  
  // Get the contract factory and deploy
  const HumanContentLedger = await hre.ethers.getContractFactory("HumanContentLedger");
  const humanContentLedger = await HumanContentLedger.deploy();
  await humanContentLedger.waitForDeployment();
  
  const contractAddress = await humanContentLedger.getAddress();
  console.log("📍 Contract deployed at:", contractAddress);
  
  // Test data (similar to what would come from the frontend)
  const testData = {
    contentHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    humanSignatureHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    keystrokeCount: 42,
    typingSpeed: 1500 // 1.5 chars/sec * 1000
  };
  
  console.log("\n📝 Storing test content...");
  
  // Store content without World ID
  const tx = await humanContentLedger.storeContent(
    testData.contentHash,
    testData.humanSignatureHash,
    testData.keystrokeCount,
    testData.typingSpeed
  );
  
  const receipt = await tx.wait();
  console.log("✅ Content stored! Transaction hash:", receipt.hash);
  
  // Retrieve the stored content
  console.log("\n📖 Retrieving stored content...");
  const entry = await humanContentLedger.getContentEntry(1);
  
  console.log("📊 Retrieved Entry:");
  console.log("   Content Hash:", entry.contentHash);
  console.log("   Human Signature Hash:", entry.humanSignatureHash);
  console.log("   Author:", entry.author);
  console.log("   Keystroke Count:", entry.keystrokeCount.toString());
  console.log("   Typing Speed:", entry.typingSpeed.toString());
  console.log("   Is Verified:", entry.isVerified);
  console.log("   Timestamp:", new Date(Number(entry.timestamp) * 1000).toISOString());
  
  // Test duplicate protection
  console.log("\n🔒 Testing duplicate protection...");
  try {
    await humanContentLedger.storeContent(
      testData.contentHash,
      "0x9999999999999999999999999999999999999999999999999999999999999999",
      testData.keystrokeCount,
      testData.typingSpeed
    );
    console.log("❌ ERROR: Duplicate content should have been rejected!");
  } catch (error) {
    console.log("✅ Duplicate content correctly rejected:", error.reason);
  }
  
  // Check total entries
  const totalEntries = await humanContentLedger.getTotalEntries();
  console.log("\n📈 Total entries stored:", totalEntries.toString());
  
  // Test content existence
  const exists = await humanContentLedger.contentExists(testData.contentHash);
  console.log("🔍 Content exists:", exists);
  
  console.log("\n🎉 All tests completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
