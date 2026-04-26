import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useKeystrokeCapture } from '../hooks/useKeystrokeCapture';
import { useBiometricProcessor } from '../hooks/useBiometricProcessor';
import { hashContent } from '../utils/crypto';
import { useWorldID } from '../hooks/useWorldID';
import WorldIDWidget from '../components/WorldIDWidget';
import { blockchainService } from '../blockchain';

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

function formatMs(n: number, digits = 2) {
  return n.toFixed(digits);
}

function BiometricTimingRows({ s }: { s: FeatureStatistics }) {
  return (
    <>
      <tr>
        <td>Mean</td>
        <td>{formatMs(s.mean)} ms</td>
      </tr>
      <tr>
        <td>σ</td>
        <td>{formatMs(s.standardDeviation)} ms</td>
      </tr>
      <tr>
        <td>Median</td>
        <td>{formatMs(s.median)} ms</td>
      </tr>
      <tr>
        <td>Min / max</td>
        <td>
          {formatMs(s.min)} / {formatMs(s.max)} ms
        </td>
      </tr>
    </>
  );
}

interface HomePageProps {
  isInWorldApp?: boolean;
  onVerifyMiniKit?: () => Promise<void>;
}

function HomePage({ isInWorldApp = false, onVerifyMiniKit }: HomePageProps) {
  const [content, setContent] = useState<string>('');
  const [humanSignatureHash, setHumanSignatureHash] = useState<string>('');
  const [contentHash, setContentHash] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [biometricData, setBiometricData] = useState<DetailedBiometricData | null>(null);
  /** Count of times the document became hidden during the capture that produced the current analysis. */
  const [sessionTabAwayCount, setSessionTabAwayCount] = useState(0);
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const { startCapture, stopCapture, getRawKeystrokeData, getTabAwayCount, resetCapture, isCapturing } = useKeystrokeCapture();
  const { generateHumanSignatureHash } = useBiometricProcessor();
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
    return () => {
      if (isCapturing) {
        stopCapture();
      }
    };
  }, [isCapturing, stopCapture]);

  const handleStartCapture = () => {
    console.log('Manual start capture clicked');
    if (textareaRef.current) {
      resetCapture();
      setHumanSignatureHash('');
      setContentHash('');
      setBiometricData(null);
      setSessionTabAwayCount(0);
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

      const tabAwayCount = getTabAwayCount();
      
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
      setSessionTabAwayCount(tabAwayCount);
      
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

  const handleResetAll = () => {
    setContent('');
    setHumanSignatureHash('');
    setContentHash('');
    setBiometricData(null);
    setSessionTabAwayCount(0);
    setProcessingStatus('');
    setBlockchainErrorHelp(null);
    setBlockchainSuccess(null);
    resetCapture();
    resetVerification();
  };

  return (
    <>
        <div className="hi-block">
          <WorldIDWidget
            isVerified={isVerified}
            worldIdProof={worldIdProof}
            error={worldIdError}
            isLoading={worldIdLoading}
            onVerify={handleVerify}
            onError={handleError}
            onVerifyMiniKit={onVerifyMiniKit}
            isInWorldApp={isInWorldApp}
          />
        </div>

        <div className="hi-section">
          <h2>Write your content</h2>
          <p>
            Your authorship is captured through behavioral biometrics including keystroke dynamics, hold times, flight
            intervals, and digraph latencies. All signals are processed locally in your browser and never transmitted to
            a server.
          </p>
          {!isCapturing ? (
            <div className="hi-session-gate">
              <button
                type="button"
                className="hi-btn hi-btn--session"
                onClick={handleStartCapture}
                disabled={isProcessing}
              >
                Start your creative session
              </button>
              <div className="hi-session-gate__hint" role="note">
                Keystroke timing is recorded only after you begin.
                <br />
                You can start a new session anytime.
              </div>
            </div>
          ) : (
            <div className="hi-capture-status hi-capture-status--active" role="status">
              <div className="hi-capture-status__row">
                <span>
                  <strong>Status:</strong> Capturing keystrokes
                </span>
                <button
                  type="button"
                  className="hi-btn hi-btn--ghost hi-btn--sm"
                  onClick={handleStartCapture}
                  disabled={isProcessing}
                >
                  New session
                </button>
              </div>
            </div>
          )}
          <p className="hi-warn-line">
            Copy and paste are disabled to keep biometrics accurate. Type your content manually.
          </p>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleInputChange}
            disabled={!isCapturing}
            aria-label="Text to capture keystrokes for biometric signing"
            title={!isCapturing ? 'Start your creative session to enable typing' : undefined}
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
            placeholder={
              isCapturing
                ? 'Start typing… keystroke patterns are used for the biometric analysis (no paste)'
                : 'Start your session above, then type here (paste is off)'
            }
            className={
              isCapturing ? 'hi-textarea hi-textarea--capturing' : 'hi-textarea hi-textarea--gated'
            }
          />
        </div>
        
        <div className="hi-btn-row">
          {isCapturing && <span className="hi-capture-pill">Capturing…</span>}
          <button 
            type="button"
            onClick={handleGenerateSignature}
            disabled={isProcessing || !isCapturing || !content.trim()}
            className="hi-btn hi-btn--primary"
          >
            {isProcessing ? 'Processing…' : 'Generate local signature'}
          </button>

          <button 
            type="button"
            onClick={handleSubmitToBlockchain}
            disabled={isSubmittingToBlockchain || !humanSignatureHash || !contentHash}
            className="hi-btn hi-btn--submit"
          >
            {isSubmittingToBlockchain ? 'Submitting…' : 'Submit to blockchain'}
          </button>

          <button 
            type="button"
            onClick={handleResetAll}
            disabled={isProcessing || isSubmittingToBlockchain}
            className="hi-btn hi-btn--danger"
          >
            Reset all
          </button>
        </div>
        
        {processingStatus && (
          <div className="hi-status-panel">
            <strong>Status:</strong> {processingStatus}
            {blockchainErrorHelp?.explorerAddressUrl && (
              <div className="hi-blockchain-help" style={{ marginTop: 12, fontSize: 14 }}>
                <p style={{ margin: '0 0 6px' }}>
                  <a
                    href={blockchainErrorHelp.explorerAddressUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open your address on the block explorer
                  </a>
                </p>
                <p style={{ margin: '0 0 4px' }} className="hi-muted">
                  If the explorer does not open (common inside in-app browsers), copy this URL:
                </p>
                <code className="hi-code-inline">
                  {blockchainErrorHelp.explorerAddressUrl}
                </code>
              </div>
            )}
          </div>
        )}

        {blockchainSuccess && (
          <div className="hi-success-panel">
            <h3 className="hi-success-panel__title">
              Submitted onchain
              {typeof blockchainSuccess.entryId === 'number' && (
                <span className="hi-success-panel__meta"> · Entry #{blockchainSuccess.entryId}</span>
              )}
            </h3>
            {blockchainSuccess.statusNote && <p className="hi-success-panel__note">{blockchainSuccess.statusNote}</p>}
            <div className="hi-success-panel__row">
              <span className="hi-success-panel__label">Tx hash</span>
              <code className="hi-success-panel__hash">{blockchainSuccess.transactionHash}</code>
              <button
                type="button"
                className="hi-btn hi-btn--link hi-success-panel__copy"
                onClick={() => navigator.clipboard?.writeText(blockchainSuccess.transactionHash)}
              >
                Copy
              </button>
            </div>
            {blockchainSuccess.gasUsed && (
              <p className="hi-success-panel__gas">
                <span className="hi-success-panel__label">Gas used</span> {blockchainSuccess.gasUsed}
              </p>
            )}
            {(blockchainSuccess.explorerTxUrl || blockchainSuccess.explorerContractUrl) && (
              <div className="hi-success-panel__links">
                {blockchainSuccess.explorerTxUrl && (
                  <a href={blockchainSuccess.explorerTxUrl} target="_blank" rel="noopener noreferrer">
                    View transaction
                  </a>
                )}
                {blockchainSuccess.explorerContractUrl && (
                  <a href={blockchainSuccess.explorerContractUrl} target="_blank" rel="noopener noreferrer">
                    Open contract
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* 🎯 DETAILED BIOMETRIC DATA DISPLAY */}
        {biometricData && (
          <div className="hi-section">
            <h3>Biometric analysis</h3>
            <div className="hi-bio">
              <div className="hi-bio__table-wrap">
                <table className="hi-table hi-bio__table">
                  <thead>
                    <tr>
                      <th scope="col">Metric</th>
                      <th scope="col">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="hi-bio__row-section">
                      <td colSpan={2}>Session</td>
                    </tr>
                    <tr>
                      <td>Keystrokes</td>
                      <td>{biometricData.totalKeystrokes}</td>
                    </tr>
                    <tr>
                      <td>Duration</td>
                      <td>{(biometricData.captureTimespan / 1000).toFixed(2)} s</td>
                    </tr>
                    <tr>
                      <td>Typing speed</td>
                      <td>{biometricData.rawFeatures.typingSpeed.toFixed(2)} c/s</td>
                    </tr>
                    <tr>
                      <td>Backspace</td>
                      <td>{biometricData.rawFeatures.backspaceCount}</td>
                    </tr>
                    <tr>
                      <td>Left tab / window</td>
                      <td>{sessionTabAwayCount}×</td>
                    </tr>
                    <tr className="hi-bio__row-section">
                      <td colSpan={2}>Hold times (dwell)</td>
                    </tr>
                    <tr className="hi-bio__row-hint">
                      <td colSpan={2}>
                        <span>Key hold duration (down → up)</span>
                      </td>
                    </tr>
                    <BiometricTimingRows s={biometricData.statistics.holdTimes} />
                    <tr className="hi-bio__row-section">
                      <td colSpan={2}>Flight times (inter-key)</td>
                    </tr>
                    <tr className="hi-bio__row-hint">
                      <td colSpan={2}>
                        <span>Key release to next key press</span>
                      </td>
                    </tr>
                    <BiometricTimingRows s={biometricData.statistics.flightTimes} />
                    <tr className="hi-bio__row-section">
                      <td colSpan={2}>Down–down (digraph)</td>
                    </tr>
                    <tr className="hi-bio__row-hint">
                      <td colSpan={2}>
                        <span>Time between consecutive key presses</span>
                      </td>
                    </tr>
                    <BiometricTimingRows s={biometricData.statistics.downDownLatencies} />
                    <tr className="hi-bio__row-section">
                      <td colSpan={2}>Feature vector (for hash)</td>
                    </tr>
                    <tr className="hi-bio__row-hint">
                      <td colSpan={2}>
                        <span>Numeric pattern for this session</span>
                      </td>
                    </tr>
                    <tr className="hi-bio__row-vector">
                      <td colSpan={2}>
                        <code className="hi-bio__vec hi-bio__vec--table">
                          [{biometricData.featureVector.map((val) => val.toFixed(4)).join(', ')}]
                        </code>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        
        {humanSignatureHash && (
          <div className="hi-section">
            <h3>Human signature hash</h3>
            <div className="hi-hash-block">{humanSignatureHash}</div>
            <p className="hi-hash-line">Generated on this device. Raw typing data is not sent off-device.</p>
          </div>
        )}
        
        {contentHash && (
          <div className="hi-section">
            <h3>Content hash</h3>
            <div className="hi-hash-block">{contentHash}</div>
            <p className="hi-content-hash-note">SHA-256 of your UTF-8 text (what the chain stores as a hash, not the text)</p>
          </div>
        )}
        
        <div className="hi-workflow">
          <h3>Workflow</h3>
          <ol>
            <li>
              <strong>World ID:</strong> verify proof of personhood in the widget above
            </li>
            <li>
              <strong>Capture:</strong> type in the field so your keystroke timing can be recorded
            </li>
            <li>
              <strong>Hash locally:</strong> your human signature and content hashes are computed in your browser
            </li>
            <li>
              <strong>Submit onchain:</strong> send a transaction to the Human Content Ledger with your wallet
            </li>
            <li>
              <strong>Permanence:</strong> the ledger stores your attestation and hashes onchain, never your plaintext
            </li>
          </ol>
          <h4>Privacy and security</h4>
          <ul>
            <li>World ID proves you&rsquo;re human without sharing your identity in plain text</li>
            <li>Biometric feature vectors and hashes are processed locally before you submit</li>
            <li>Only hashes go onchain in this app, never the content itself</li>
            <li>See the contract for exact fields stored</li>
          </ul>
          <p className="hi-workflow__more">
            <Link to="/workflow">How it works — full guide and privacy details</Link>
          </p>
        </div>
    </>
  );
}

export default HomePage;
