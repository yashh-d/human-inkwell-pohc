import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { useKeystrokeCapture } from './hooks/useKeystrokeCapture';
import { useBiometricProcessor } from './hooks/useBiometricProcessor';
import { hashContent } from './utils/crypto';
import { useWorldID } from './hooks/useWorldID';
import WorldIDWidget from './components/WorldIDWidget';
import { blockchainService } from './blockchain';
import {
  getInjectedSigner,
  syncLedgerToSupabase,
  fetchMyLedgerRows,
  explorerTxUrl,
  type LedgerSubmissionRow,
} from './ledgerSupabase';

// Define interfaces for detailed biometric data
interface BiometricFeatures {
  holdTimes: number[];
  flightTimes: number[];
  downDownLatencies: number[];
  typingSpeed: number;
  backspaceCount: number;
}

interface FeatureStatistics {
  mean: number;
  standardDeviation: number;
  median: number;
  min: number;
  max: number;
}

interface DetailedBiometricData {
  rawFeatures: BiometricFeatures;
  statistics: {
    holdTimes: FeatureStatistics;
    flightTimes: FeatureStatistics;
    downDownLatencies: FeatureStatistics;
  };
  featureVector: number[];
  totalKeystrokes: number;
  captureTimespan: number;
}

interface KeystrokeEvent {
  key: string;
  eventType: 'keydown' | 'keyup';
  timestamp: number;
}

function App() {
  const [content, setContent] = useState<string>('');
  const [humanSignatureHash, setHumanSignatureHash] = useState<string>('');
  const [contentHash, setContentHash] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [biometricData, setBiometricData] = useState<DetailedBiometricData | null>(null);
  const [isSubmittingToBlockchain, setIsSubmittingToBlockchain] = useState<boolean>(false);
  const [blockchainErrorHelp, setBlockchainErrorHelp] = useState<{
    explorerAddressUrl?: string;
    walletAddress?: string;
  } | null>(null);
  const [blockchainSuccess, setBlockchainSuccess] = useState<{
    transactionHash: string;
    entryId?: number;
    gasUsed?: string;
    explorerTxUrl?: string;
    explorerContractUrl?: string;
    explorerAddressUrl?: string;
    statusNote?: string;
  } | null>(null);
  const [myLedgerRows, setMyLedgerRows] = useState<LedgerSubmissionRow[] | null>(null);
  const [myLedgerError, setMyLedgerError] = useState<string | null>(null);
  const [isLoadingMyLedger, setIsLoadingMyLedger] = useState(false);
  const [ledgerSyncNote, setLedgerSyncNote] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const { startCapture, stopCapture, getRawKeystrokeData, resetCapture, isCapturing } = useKeystrokeCapture();
  const { extractFeatures, generateHumanSignatureHash } = useBiometricProcessor();
  const { 
    isVerified, 
    worldIdProof, 
    error: worldIdError, 
    isLoading: worldIdLoading, 
    handleVerify, 
    handleError, 
    resetVerification 
  } = useWorldID();

  // Function to calculate statistics
  const calculateStatistics = (values: number[]): FeatureStatistics => {
    if (values.length === 0) {
      return { mean: 0, standardDeviation: 0, median: 0, min: 0, max: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const standardDeviation = Math.sqrt(variance);
    const median = sorted.length % 2 === 0 
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    return { mean, standardDeviation, median, min, max };
  };

  // Function to extract detailed biometric features
  const extractDetailedFeatures = (rawKeystrokeData: KeystrokeEvent[]): DetailedBiometricData => {
    const features: BiometricFeatures = {
      holdTimes: [],
      flightTimes: [],
      downDownLatencies: [],
      typingSpeed: 0,
      backspaceCount: 0
    };

    // Group events by key and timestamp for processing
    const keyDownEvents: { [key: string]: number[] } = {};
    const keyUpEvents: { [key: string]: number[] } = {};
    const allKeyDowns: { key: string; timestamp: number }[] = [];
    const allKeyUps: { key: string; timestamp: number }[] = [];

    rawKeystrokeData.forEach(event => {
      if (event.eventType === 'keydown') {
        if (!keyDownEvents[event.key]) keyDownEvents[event.key] = [];
        keyDownEvents[event.key].push(event.timestamp);
        allKeyDowns.push({ key: event.key, timestamp: event.timestamp });
      } else {
        if (!keyUpEvents[event.key]) keyUpEvents[event.key] = [];
        keyUpEvents[event.key].push(event.timestamp);
        allKeyUps.push({ key: event.key, timestamp: event.timestamp });
      }
    });

    // Sort by timestamp
    allKeyDowns.sort((a, b) => a.timestamp - b.timestamp);
    allKeyUps.sort((a, b) => a.timestamp - b.timestamp);

    // Calculate hold times (dwell times)
    Object.keys(keyDownEvents).forEach(key => {
      const downs = keyDownEvents[key];
      const ups = keyUpEvents[key] || [];
      
      downs.forEach(downTime => {
        const correspondingUp = ups.find(upTime => upTime > downTime);
        if (correspondingUp) {
          features.holdTimes.push(correspondingUp - downTime);
        }
      });
    });

    // Calculate flight times (key release to next key press)
    for (let i = 0; i < allKeyUps.length - 1; i++) {
      const currentUp = allKeyUps[i];
      const nextDown = allKeyDowns.find(down => down.timestamp > currentUp.timestamp);
      if (nextDown) {
        features.flightTimes.push(nextDown.timestamp - currentUp.timestamp);
      }
    }

    // Calculate down-down latencies (digraph times)
    for (let i = 0; i < allKeyDowns.length - 1; i++) {
      const currentDown = allKeyDowns[i];
      const nextDown = allKeyDowns[i + 1];
      features.downDownLatencies.push(nextDown.timestamp - currentDown.timestamp);
    }

    // Calculate typing speed (characters per second)
    if (allKeyDowns.length > 1) {
      const totalTime = allKeyDowns[allKeyDowns.length - 1].timestamp - allKeyDowns[0].timestamp;
      features.typingSpeed = (allKeyDowns.length / totalTime) * 1000; // Convert to characters per second
    }

    // Count backspace presses
    features.backspaceCount = keyDownEvents['Backspace']?.length || 0;

    // Calculate statistics
    const holdStats = calculateStatistics(features.holdTimes);
    const flightStats = calculateStatistics(features.flightTimes);
    const ddStats = calculateStatistics(features.downDownLatencies);

    // Generate feature vector from statistics
    const featureVector: number[] = [];
    featureVector.push(holdStats.mean, holdStats.standardDeviation, holdStats.median, holdStats.min, holdStats.max);
    featureVector.push(flightStats.mean, flightStats.standardDeviation, flightStats.median, flightStats.min, flightStats.max);
    featureVector.push(ddStats.mean, ddStats.standardDeviation, ddStats.median, ddStats.min, ddStats.max);
    featureVector.push(features.typingSpeed, features.backspaceCount);

    // Calculate capture timespan
    const captureTimespan = allKeyDowns.length > 0 ? 
      allKeyDowns[allKeyDowns.length - 1].timestamp - allKeyDowns[0].timestamp : 0;

    return {
      rawFeatures: features,
      statistics: {
        holdTimes: holdStats,
        flightTimes: flightStats,
        downDownLatencies: ddStats,
      },
      featureVector,
      totalKeystrokes: allKeyDowns.length,
      captureTimespan
    };
  };

  useEffect(() => {
    // Use a timeout to ensure the textarea is fully rendered
    const timer = setTimeout(() => {
      if (textareaRef.current && !isCapturing) {
        console.log('Initializing capture on mount');
        startCapture(textareaRef.current);
      }
    }, 100);
    
    return () => {
      clearTimeout(timer);
      if (isCapturing) {
        console.log('Cleaning up capture on unmount');
        stopCapture();
      }
    };
  }, [isCapturing, startCapture, stopCapture]);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
  };

  const handleStartCapture = () => {
    console.log('Manual start capture clicked');
    if (textareaRef.current) {
      resetCapture();
      setHumanSignatureHash('');
      setContentHash('');
      setBiometricData(null);
      setProcessingStatus('Ready to capture keystrokes...');
      startCapture(textareaRef.current);
    }
  };

  const handleGenerateSignature = async () => {
    if (!textareaRef.current) return;
    
    setIsProcessing(true);
    setProcessingStatus('Processing keystroke data...');
    
    try {
      // Stop capturing keystrokes
      stopCapture();
      
      // Get raw keystroke data
      const rawKeystrokeData = getRawKeystrokeData();
      
      console.log('Raw keystroke data:', rawKeystrokeData); // Debug log
      
      if (rawKeystrokeData.length === 0) {
        setProcessingStatus('No keystroke data captured. Please type something first, then try again.');
        setIsProcessing(false);
        return;
      }
      
      if (rawKeystrokeData.length < 10) {
        setProcessingStatus(`Only ${rawKeystrokeData.length} keystroke events captured. Please type more content for better analysis.`);
        setIsProcessing(false);
        return;
      }
      
      setProcessingStatus('Extracting detailed biometric features...');
      
      // Extract detailed biometric features
      const detailedFeatures = extractDetailedFeatures(rawKeystrokeData);
      setBiometricData(detailedFeatures);
      
      console.log('Detailed biometric features:', detailedFeatures); // Debug log
      
      if (detailedFeatures.featureVector.length === 0) {
        setProcessingStatus('Failed to extract biometric features. Please try typing again.');
        setIsProcessing(false);
        return;
      }
      
      setProcessingStatus('Generating human signature hash...');
      
      // Generate human signature hash
      const humanHash = await generateHumanSignatureHash(detailedFeatures.featureVector);
      setHumanSignatureHash(humanHash);
      
      setProcessingStatus('Generating content hash...');
      
      // Generate content hash
      const textHash = await hashContent(content);
      setContentHash(textHash);
      
      setProcessingStatus('Processing complete! Both hashes generated successfully.');
      
      // Reset capture for next session
      resetCapture();
      
    } catch (error) {
      console.error('Error processing biometric data:', error);
      setProcessingStatus(`Error processing biometric data: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Enhanced paste prevention with input filtering
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const currentValue = content;
    
    // Check if the change is too large (indicating paste)
    const lengthDifference = newValue.length - currentValue.length;
    if (lengthDifference > 5) {
      // Likely a paste operation - revert and show warning
      e.preventDefault();
      setProcessingStatus('⚠️ Large text insertion detected (possible paste). Please type content manually for accurate biometric analysis.');
      return;
    }
    
    setContent(newValue);
  };

  // Handle focus to ensure capture is active
  const handleTextareaFocus = () => {
    console.log('Textarea focused');
    if (textareaRef.current && !isCapturing) {
      console.log('Starting capture on focus');
      startCapture(textareaRef.current);
    }
  };

  const handleSubmitToBlockchain = async () => {
    if (!humanSignatureHash || !contentHash) {
      setProcessingStatus('⚠️ Please generate both human signature and content hash before submitting to blockchain.');
      return;
    }

    if (!biometricData) {
      setProcessingStatus('⚠️ No biometric data available. Please capture keystrokes first.');
      return;
    }

    setIsSubmittingToBlockchain(true);
    setBlockchainErrorHelp(null);
    setBlockchainSuccess(null);
    setProcessingStatus('🔗 Connecting to wallet...');

    try {
      // Prepare submission data
      const submissionData = {
        contentHash,
        humanSignatureHash,
        keystrokeCount: biometricData.totalKeystrokes,
        typingSpeed: biometricData.rawFeatures.typingSpeed,
        worldIdNullifier: isVerified ? worldIdProof?.nullifier_hash : undefined
      };

      console.log('🔒 Blockchain Submission Data:', submissionData);

      setProcessingStatus('⛓️ Submitting to Human Content Ledger...');
      
      // Submit to blockchain (progress + long on-chain wait happen inside; avoids false "0 gas" errors on first try)
      const result = await blockchainService.submitContent(submissionData, {
        onProgress: (msg) => {
          setProcessingStatus(msg);
        },
      });
      
      if (result.success && result.transactionHash) {
        setBlockchainErrorHelp(null);
        setBlockchainSuccess({
          transactionHash: result.transactionHash,
          entryId: result.entryId,
          gasUsed: result.gasUsed,
          explorerTxUrl: result.explorerTxUrl,
          explorerContractUrl: result.explorerContractUrl,
          explorerAddressUrl: result.explorerAddressUrl,
          statusNote: result.statusNote,
        });
        setProcessingStatus('✅ Submitted to Human Content Ledger.');
        setLedgerSyncNote(null);
        try {
          if (result.entryId != null) {
            const signer = await getInjectedSigner();
            await syncLedgerToSupabase(signer, result, {
              contentHash,
              humanSignatureHash,
              keystrokeCount: biometricData.totalKeystrokes,
              typingSpeed: biometricData.rawFeatures.typingSpeed,
              isVerified: isVerified,
              worldIdNullifier: worldIdProof?.nullifier_hash,
            });
            setLedgerSyncNote('Saved to your private ledger (database).');
          }
        } catch (e) {
          console.warn('Ledger API sync failed', e);
          setLedgerSyncNote(
            'On-chain success; database log failed. On Vercel, set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. ' +
              'For local dev use `vercel dev` in `client/` (plain `npm start` has no /api routes).'
          );
        }
        console.log('🎉 Blockchain submission successful!', result);
      } else {
        setProcessingStatus(
          result.quietUi
            ? result.error || 'Could not confirm. You can try again in a few seconds.'
            : `❌ ${result.error || 'Unknown blockchain error'}`
        );
        if (result.quietUi) {
          setBlockchainErrorHelp(null);
        } else {
          setBlockchainErrorHelp({
            explorerAddressUrl: result.explorerAddressUrl,
            walletAddress: result.walletAddress,
          });
        }
      }
      
    } catch (error) {
      console.error('Blockchain submission failed:', error);
      setProcessingStatus(`❌ Blockchain submission failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSubmittingToBlockchain(false);
    }
  };

  const handleLoadMyLedger = async () => {
    setMyLedgerError(null);
    setIsLoadingMyLedger(true);
    setMyLedgerRows(null);
    try {
      const signer = await getInjectedSigner();
      const rows = await fetchMyLedgerRows(signer);
      setMyLedgerRows(rows);
    } catch (e) {
      setMyLedgerError(e instanceof Error ? e.message : 'Failed to load ledger');
    } finally {
      setIsLoadingMyLedger(false);
    }
  };

  const handleResetAll = () => {
    setContent('');
    setHumanSignatureHash('');
    setContentHash('');
    setBiometricData(null);
    setProcessingStatus('');
    setBlockchainErrorHelp(null);
    setBlockchainSuccess(null);
    setMyLedgerRows(null);
    setMyLedgerError(null);
    setLedgerSyncNote(null);
    resetCapture();
    resetVerification();
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Human Inkwell - Biometric Keystroke Capture</h1>
        <p>Privacy-Preserving Typing Signature Generation with World ID Verification</p>
      </header>
      
      <main style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
        {/* World ID Verification Section */}
        <div style={{ marginBottom: '30px' }}>
          <WorldIDWidget
            isVerified={isVerified}
            worldIdProof={worldIdProof}
            error={worldIdError}
            isLoading={worldIdLoading}
            onVerify={handleVerify}
            onError={handleError}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <h2>Text Input Area</h2>
          <p>Type your content below. Your keystroke patterns are being captured locally.</p>
          <div style={{ 
            padding: '10px', 
            backgroundColor: isCapturing ? '#d4edda' : '#f8d7da',
            border: `1px solid ${isCapturing ? '#c3e6cb' : '#f5c6cb'}`,
            borderRadius: '4px',
            marginBottom: '10px'
          }}>
            <strong>Status:</strong> {isCapturing ? '🟢 Capturing keystrokes' : '🔴 Not capturing - click "Start New Capture"'}
          </div>
          <p style={{ 
            color: '#dc3545', 
            fontSize: '14px', 
            fontWeight: 'bold',
            marginBottom: '10px'
          }}>
            ⚠️ Copy/paste is disabled to ensure accurate biometric analysis. Please type all content manually.
          </p>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleInputChange}
            onFocus={handleTextareaFocus}
            onInput={(e) => {
              // Additional input validation
              const target = e.target as HTMLTextAreaElement;
              const newValue = target.value;
              if (newValue.length - content.length > 5) {
                target.value = content;
                setProcessingStatus('⚠️ Large text insertion detected (possible paste). Please type content manually for accurate biometric analysis.');
              }
            }}
            onPaste={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('Paste blocked!');
              setProcessingStatus('⚠️ Copy/paste is disabled. Please type your content manually for accurate biometric analysis.');
            }}
            onCopy={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setProcessingStatus('⚠️ Copy/paste is disabled. Please type your content manually for accurate biometric analysis.');
            }}
            onCut={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setProcessingStatus('⚠️ Copy/paste is disabled. Please type your content manually for accurate biometric analysis.');
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setProcessingStatus('⚠️ Drag and drop is disabled. Please type your content manually for accurate biometric analysis.');
            }}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setProcessingStatus('⚠️ Right-click menu is disabled. Please type your content manually for accurate biometric analysis.');
            }}
            onKeyDown={(e) => {
              // Disable common keyboard shortcuts for copy/paste
              if (e.ctrlKey || e.metaKey) {
                if (e.key === 'v' || e.key === 'c' || e.key === 'x' || e.key === 'a') {
                  e.preventDefault();
                  e.stopPropagation();
                  console.log('Keyboard shortcut blocked:', e.key);
                  setProcessingStatus('⚠️ Keyboard shortcuts for copy/paste are disabled. Please type your content manually for accurate biometric analysis.');
                }
              }
            }}
            placeholder="Start typing here... Your keystroke patterns will be captured for biometric analysis. (Copy/paste disabled)"
            style={{
              width: '100%',
              height: '200px',
              padding: '12px',
              fontSize: '14px',
              fontFamily: 'monospace',
              border: `2px solid ${isCapturing ? '#28a745' : '#ccc'}`,
              borderRadius: '4px',
              resize: 'vertical',
              userSelect: 'none', // Prevent text selection
              WebkitUserSelect: 'none',
              MozUserSelect: 'none',
              msUserSelect: 'none'
            }}
          />
        </div>
        
        <div style={{ marginBottom: '20px' }}>
          <button 
            onClick={handleStartCapture}
            disabled={isProcessing}
            style={{
              padding: '10px 20px',
              marginRight: '10px',
              backgroundColor: isCapturing ? '#28a745' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isProcessing ? 'not-allowed' : 'pointer'
            }}
          >
            {isCapturing ? 'Capturing...' : 'Start New Capture'}
          </button>
          
          <button 
            onClick={handleGenerateSignature}
            disabled={isProcessing || !content.trim()}
            style={{
              padding: '10px 20px',
              marginRight: '10px',
              backgroundColor: isProcessing ? '#6c757d' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: (isProcessing || !content.trim()) ? 'not-allowed' : 'pointer'
            }}
          >
            {isProcessing ? 'Processing...' : 'Generate Local Signature'}
          </button>

          <button 
            onClick={handleSubmitToBlockchain}
            disabled={isSubmittingToBlockchain || !humanSignatureHash || !contentHash}
            style={{
              padding: '10px 20px',
              marginRight: '10px',
              backgroundColor: isSubmittingToBlockchain ? '#6c757d' : (humanSignatureHash && contentHash ? '#ffc107' : '#6c757d'),
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: (isSubmittingToBlockchain || !humanSignatureHash || !contentHash) ? 'not-allowed' : 'pointer'
            }}
          >
            {isSubmittingToBlockchain ? '⛓️ Submitting...' : '🌐 Submit to Blockchain'}
          </button>

          <button 
            onClick={handleResetAll}
            disabled={isProcessing || isSubmittingToBlockchain}
            style={{
              padding: '10px 20px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: (isProcessing || isSubmittingToBlockchain) ? 'not-allowed' : 'pointer'
            }}
          >
            🔄 Reset All
          </button>
        </div>
        
        {processingStatus && (
          <div style={{ 
            padding: '10px', 
            backgroundColor: '#e9ecef', 
            border: '1px solid #dee2e6', 
            borderRadius: '4px',
            marginBottom: '20px'
          }}>
            <strong>Status:</strong> {processingStatus}
            {blockchainErrorHelp?.explorerAddressUrl && (
              <div style={{ marginTop: '12px', fontSize: '14px' }}>
                <p style={{ margin: '0 0 6px' }}>
                  <a
                    href={blockchainErrorHelp.explorerAddressUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#0d6efd' }}
                  >
                    Open your address on the block explorer
                  </a>
                </p>
                <p style={{ margin: '0 0 4px', color: '#495057' }}>
                  If the explorer does not open (common inside mini in-app browsers), copy this URL into Safari or
                  Chrome:
                </p>
                <code
                  style={{
                    display: 'block',
                    wordBreak: 'break-all',
                    padding: '6px 8px',
                    background: '#fff',
                    border: '1px solid #ced4da',
                    borderRadius: 4,
                    fontSize: '12px',
                  }}
                >
                  {blockchainErrorHelp.explorerAddressUrl}
                </code>
              </div>
            )}
          </div>
        )}

        {blockchainSuccess && (
          <div
            style={{
              padding: '14px 16px',
              backgroundColor: '#d1e7dd',
              border: '1px solid #badbcc',
              borderRadius: 6,
              marginBottom: 20,
              fontSize: 14,
              lineHeight: 1.5,
              color: '#0f5132',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              ✅ Submitted on-chain
              {typeof blockchainSuccess.entryId === 'number' && (
                <> · Entry #{blockchainSuccess.entryId}</>
              )}
            </div>
            {blockchainSuccess.statusNote && (
              <div style={{ marginBottom: 8, fontSize: 13, color: '#0a4d2e' }}>{blockchainSuccess.statusNote}</div>
            )}
            <div style={{ marginBottom: 6 }}>
              <strong>Tx hash:</strong>{' '}
              <code style={{ wordBreak: 'break-all' }}>{blockchainSuccess.transactionHash}</code>{' '}
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(blockchainSuccess.transactionHash)}
                style={{
                  marginLeft: 6,
                  padding: '2px 8px',
                  fontSize: 12,
                  border: '1px solid #0f5132',
                  background: '#fff',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Copy
              </button>
            </div>
            {blockchainSuccess.gasUsed && (
              <div style={{ marginBottom: 6 }}>
                <strong>Gas used:</strong> {blockchainSuccess.gasUsed}
              </div>
            )}
            {blockchainSuccess.explorerTxUrl && (
              <div style={{ marginBottom: 6 }}>
                <a
                  href={blockchainSuccess.explorerTxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#0d6efd', fontWeight: 600 }}
                >
                  View transaction on block explorer →
                </a>
                <div style={{ fontSize: 12, color: '#495057', marginTop: 2 }}>
                  If that link doesn’t open in an in-app browser, copy this URL into Safari/Chrome:
                </div>
                <code
                  style={{
                    display: 'block',
                    wordBreak: 'break-all',
                    padding: '6px 8px',
                    background: '#fff',
                    border: '1px solid #ced4da',
                    borderRadius: 4,
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  {blockchainSuccess.explorerTxUrl}
                </code>
              </div>
            )}
            {blockchainSuccess.explorerContractUrl && (
              <div style={{ fontSize: 12 }}>
                <a
                  href={blockchainSuccess.explorerContractUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#0d6efd' }}
                >
                  Open contract on explorer
                </a>
              </div>
            )}
            {ledgerSyncNote && (
              <p style={{ marginTop: 10, marginBottom: 0, fontSize: 13, color: '#0a4d2e' }}>{ledgerSyncNote}</p>
            )}
          </div>
        )}

        <div
          style={{
            marginBottom: 24,
            padding: 16,
            backgroundColor: '#f0f4ff',
            border: '1px solid #c3d4ff',
            borderRadius: 6,
          }}
        >
          <h3 style={{ marginTop: 0 }}>My on-chain log</h3>
          <p style={{ fontSize: 14, color: '#333', lineHeight: 1.4 }}>
            Only you can load this: your wallet signs a short “list my submissions” message. Each row is content and
            signature <strong>hashes</strong> plus the explorer link (same as on-chain, no raw text). The app calls{' '}
            <code>POST /api/ledger</code> and <code>POST /api/my-ledger</code> in this repo (Vercel serverless). Set
            project env <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> (not exposed to the
            browser) and run the SQL migration. Use <code>vercel dev</code> in <code>client/</code> so{' '}
            <code>/api/*</code> exists locally; plain <code>npm start</code> does not serve the API.
          </p>
          <button
            type="button"
            onClick={handleLoadMyLedger}
            disabled={isLoadingMyLedger}
            style={{
              padding: '10px 16px',
              backgroundColor: isLoadingMyLedger ? '#6c757d' : '#0d6efd',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: isLoadingMyLedger ? 'not-allowed' : 'pointer',
              marginRight: 8,
            }}
          >
            {isLoadingMyLedger ? 'Loading…' : 'Load my submissions'}
          </button>
          {myLedgerError && (
            <p style={{ color: '#b02a37', fontSize: 14, marginTop: 8 }}>{myLedgerError}</p>
          )}
          {myLedgerRows && myLedgerRows.length === 0 && !myLedgerError && (
            <p style={{ fontSize: 14, marginTop: 8, color: '#666' }}>No rows yet, or the API is not available (add DB env and use vercel dev / deploy).</p>
          )}
          {myLedgerRows && myLedgerRows.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                  background: '#fff',
                }}
              >
                <thead>
                  <tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
                    <th style={{ padding: 6 }}>Entry</th>
                    <th style={{ padding: 6 }}>Content hash (trunc.)</th>
                    <th style={{ padding: 6 }}>Tx (explorer)</th>
                    <th style={{ padding: 6 }}>World ID</th>
                    <th style={{ padding: 6 }}>When (indexed)</th>
                  </tr>
                </thead>
                <tbody>
                  {myLedgerRows.map((r) => (
                    <tr key={`${r.chain_id}-${r.entry_id}-${r.transaction_hash}`} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: 6 }}>#{r.entry_id}</td>
                      <td style={{ padding: 6, fontFamily: 'monospace' }}>
                        {r.content_hash.slice(0, 10)}…{r.content_hash.slice(-6)}
                      </td>
                      <td style={{ padding: 6 }}>
                        <a href={explorerTxUrl(r.transaction_hash)} target="_blank" rel="noopener noreferrer" style={{ color: '#0d6efd' }}>
                          View
                        </a>
                      </td>
                      <td style={{ padding: 6 }}>{r.is_verified ? 'Yes' : '—'}</td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                        {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        
        {/* 🎯 DETAILED BIOMETRIC DATA DISPLAY */}
        {biometricData && (
          <div style={{ marginBottom: '20px' }}>
            <h3>📊 Detailed Biometric Analysis</h3>
            <div style={{ 
              backgroundColor: '#f8f9fa', 
              padding: '15px', 
              borderRadius: '4px',
              border: '1px solid #dee2e6'
            }}>
              <h4>⏱️ Typing Session Overview</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginBottom: '20px' }}>
                <div>
                  <strong>Total Keystrokes:</strong> {biometricData.totalKeystrokes}
                </div>
                <div>
                  <strong>Session Duration:</strong> {(biometricData.captureTimespan / 1000).toFixed(2)}s
                </div>
                <div>
                  <strong>Typing Speed:</strong> {biometricData.rawFeatures.typingSpeed.toFixed(2)} chars/sec
                </div>
                <div>
                  <strong>Backspace Count:</strong> {biometricData.rawFeatures.backspaceCount}
                </div>
              </div>

              <h4>🔒 Hold Times (Dwell Times)</h4>
              <p style={{ fontSize: '12px', color: '#6c757d' }}>Time duration keys are held down</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '20px' }}>
                <div><strong>Mean:</strong> {biometricData.statistics.holdTimes.mean.toFixed(2)}ms</div>
                <div><strong>Std Dev:</strong> {biometricData.statistics.holdTimes.standardDeviation.toFixed(2)}ms</div>
                <div><strong>Median:</strong> {biometricData.statistics.holdTimes.median.toFixed(2)}ms</div>
                <div><strong>Min:</strong> {biometricData.statistics.holdTimes.min.toFixed(2)}ms</div>
                <div><strong>Max:</strong> {biometricData.statistics.holdTimes.max.toFixed(2)}ms</div>
              </div>

              <h4>🚀 Flight Times (Inter-key Intervals)</h4>
              <p style={{ fontSize: '12px', color: '#6c757d' }}>Time between key release and next key press</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '20px' }}>
                <div><strong>Mean:</strong> {biometricData.statistics.flightTimes.mean.toFixed(2)}ms</div>
                <div><strong>Std Dev:</strong> {biometricData.statistics.flightTimes.standardDeviation.toFixed(2)}ms</div>
                <div><strong>Median:</strong> {biometricData.statistics.flightTimes.median.toFixed(2)}ms</div>
                <div><strong>Min:</strong> {biometricData.statistics.flightTimes.min.toFixed(2)}ms</div>
                <div><strong>Max:</strong> {biometricData.statistics.flightTimes.max.toFixed(2)}ms</div>
              </div>

              <h4>⚡ Down-Down Latencies (Digraph Times)</h4>
              <p style={{ fontSize: '12px', color: '#6c757d' }}>Time between consecutive key presses</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '20px' }}>
                <div><strong>Mean:</strong> {biometricData.statistics.downDownLatencies.mean.toFixed(2)}ms</div>
                <div><strong>Std Dev:</strong> {biometricData.statistics.downDownLatencies.standardDeviation.toFixed(2)}ms</div>
                <div><strong>Median:</strong> {biometricData.statistics.downDownLatencies.median.toFixed(2)}ms</div>
                <div><strong>Min:</strong> {biometricData.statistics.downDownLatencies.min.toFixed(2)}ms</div>
                <div><strong>Max:</strong> {biometricData.statistics.downDownLatencies.max.toFixed(2)}ms</div>
              </div>

              <h4>🔢 Feature Vector (Used for Hashing)</h4>
              <p style={{ fontSize: '12px', color: '#6c757d' }}>The numerical array that represents your unique typing pattern</p>
              <div style={{ 
                backgroundColor: '#e9ecef', 
                padding: '10px', 
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '12px',
                wordBreak: 'break-all',
                maxHeight: '150px',
                overflowY: 'auto'
              }}>
                [{biometricData.featureVector.map(val => val.toFixed(4)).join(', ')}]
              </div>
            </div>
          </div>
        )}
        
        {humanSignatureHash && (
          <div style={{ marginBottom: '20px' }}>
            <h3>🔐 Human Signature Hash</h3>
            <div style={{ 
              backgroundColor: '#f8f9fa', 
              padding: '12px', 
              borderRadius: '4px',
              border: '1px solid #dee2e6',
              wordBreak: 'break-all',
              fontFamily: 'monospace'
            }}>
              {humanSignatureHash}
            </div>
            <p style={{ 
              color: '#28a745', 
              fontSize: '14px', 
              marginTop: '8px',
              fontWeight: 'bold'
            }}>
              🔒 This hash was generated locally on your device. Your raw typing data was never sent anywhere.
            </p>
          </div>
        )}
        
        {contentHash && (
          <div style={{ marginBottom: '20px' }}>
            <h3>📄 Content Hash</h3>
            <div style={{ 
              backgroundColor: '#f8f9fa', 
              padding: '12px', 
              borderRadius: '4px',
              border: '1px solid #dee2e6',
              wordBreak: 'break-all',
              fontFamily: 'monospace'
            }}>
              {contentHash}
            </div>
            <p style={{ 
              color: '#007bff', 
              fontSize: '14px', 
              marginTop: '8px'
            }}>
              📝 SHA-256 hash of your typed content
            </p>
          </div>
        )}
        
        <div style={{ 
          marginTop: '30px', 
          padding: '20px', 
          backgroundColor: '#e3f2fd', 
          borderRadius: '4px',
          border: '1px solid #bbdefb'
        }}>
          <h3>🔗 Blockchain Integration Workflow</h3>
          <ol style={{ textAlign: 'left', paddingLeft: '20px' }}>
            <li><strong>🌍 World ID Verification:</strong> Verify your humanness with World ID (privacy-preserving proof of personhood)</li>
            <li><strong>⌨️ Type Content:</strong> Type your content manually to capture biometric keystroke patterns</li>
            <li><strong>🔒 Generate Signatures:</strong> Create both human signature and content hash locally</li>
            <li><strong>⛓️ Submit to Blockchain:</strong> Upload verified human content to the decentralized ledger</li>
            <li><strong>🎯 Permanent Record:</strong> Your human-verified content is now immutably stored on blockchain</li>
          </ol>
          
          <h4>Privacy & Security Features:</h4>
          <ul style={{ textAlign: 'left', paddingLeft: '20px' }}>
            <li>🔐 <strong>Zero-Knowledge Proof:</strong> World ID proves humanness without revealing identity</li>
            <li>🖥️ <strong>Local Processing:</strong> All biometric analysis happens in your browser</li>
            <li>🔒 <strong>Hash-Only Storage:</strong> Only cryptographic hashes are stored on blockchain</li>
            <li>🌐 <strong>Decentralized:</strong> No central authority controls your data</li>
          </ul>
        </div>
      </main>
    </div>
  );
}

export default App;
