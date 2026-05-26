import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ISuccessResult, IErrorState } from '@worldcoin/idkit';
import { useKeystrokeCapture } from '../hooks/useKeystrokeCapture';
import { useBiometricProcessor } from '../hooks/useBiometricProcessor';
import { hashContent } from '../utils/crypto';
import {
  humanFocusScoreFromTabAwayCount,
  HUMAN_FOCUS_SCORE_POINTS_OFF_PER_LEAVE,
} from '../utils/humanFocusScore';
import {
  buildAttestationShareBody,
  buildAttestationShareForX,
  xIntentUrl,
  LINKEDIN_FEED_URL,
} from '../utils/socialShare';
import WorldIDWidget from '../components/WorldIDWidget';
import { blockchainService } from '../blockchain';
import { useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import { rememberMiniKitWallet } from '../utils/miniKitWallet';

// ─── Biometric typing ────────────────────────────────────────────────────
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

type PauseWindow = { startedAt: number; endedAt: number };

/** Loading phrases rotated while the on-chain submit is in flight. One is
 *  picked at random per submission and shown until success / error — they keep
 *  the page calm instead of leaking the verbose progress text from blockchain.ts. */
const SUBMIT_PHRASES = [
  'Chiseling your name into the chain',
  'Setting your words in stone',
  'Carving your signature in',
  'Etching your proof forever',
  'Stamping your authorship',
  'Pressing your mark onchain',
];

function pickSubmitPhrase(): string {
  return SUBMIT_PHRASES[Math.floor(Math.random() * SUBMIT_PHRASES.length)];
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

function calculateStatistics(values: number[]): FeatureStatistics {
  if (values.length === 0) {
    return { mean: 0, standardDeviation: 0, median: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance =
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const standardDeviation = Math.sqrt(variance);
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
  return { mean, standardDeviation, median, min: sorted[0], max: sorted[sorted.length - 1] };
}

/** Extract detailed biometric features.
 *
 *  pauseWindows: wall-clock (Date.now()) ranges during which capture was
 *  paused. For each event timestamp `t`, we subtract the cumulative
 *  pause-duration of every fully-elapsed window so a multi-minute pause
 *  becomes a zero-ms gap in the feature vector — the hash represents an
 *  unbroken typing rhythm. */
function extractDetailedFeatures(
  rawKeystrokeData: KeystrokeEvent[],
  pauseWindows: PauseWindow[] = []
): DetailedBiometricData {
  const adjustTimestamp = (t: number): number => {
    let offset = 0;
    for (const pw of pauseWindows) {
      if (pw.endedAt > 0 && pw.endedAt <= t && pw.endedAt > pw.startedAt) {
        offset += pw.endedAt - pw.startedAt;
      }
    }
    return t - offset;
  };
  const normalizedEvents: KeystrokeEvent[] = rawKeystrokeData.map((e) => ({
    key: e.key,
    eventType: e.eventType,
    timestamp: adjustTimestamp(e.timestamp),
  }));

  const features: BiometricFeatures = {
    holdTimes: [],
    flightTimes: [],
    downDownLatencies: [],
    typingSpeed: 0,
    backspaceCount: 0,
  };

  const keyDownEvents: { [key: string]: number[] } = {};
  const keyUpEvents: { [key: string]: number[] } = {};
  const allKeyDowns: { key: string; timestamp: number }[] = [];
  const allKeyUps: { key: string; timestamp: number }[] = [];

  normalizedEvents.forEach((event) => {
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

  allKeyDowns.sort((a, b) => a.timestamp - b.timestamp);
  allKeyUps.sort((a, b) => a.timestamp - b.timestamp);

  Object.keys(keyDownEvents).forEach((key) => {
    const downs = keyDownEvents[key];
    const ups = keyUpEvents[key] || [];
    downs.forEach((downTime) => {
      const correspondingUp = ups.find((upTime) => upTime > downTime);
      if (correspondingUp) {
        features.holdTimes.push(correspondingUp - downTime);
      }
    });
  });

  for (let i = 0; i < allKeyUps.length - 1; i++) {
    const currentUp = allKeyUps[i];
    const nextDown = allKeyDowns.find((down) => down.timestamp > currentUp.timestamp);
    if (nextDown) {
      features.flightTimes.push(nextDown.timestamp - currentUp.timestamp);
    }
  }

  for (let i = 0; i < allKeyDowns.length - 1; i++) {
    const currentDown = allKeyDowns[i];
    const nextDown = allKeyDowns[i + 1];
    features.downDownLatencies.push(nextDown.timestamp - currentDown.timestamp);
  }

  if (allKeyDowns.length > 1) {
    const totalTime =
      allKeyDowns[allKeyDowns.length - 1].timestamp - allKeyDowns[0].timestamp;
    features.typingSpeed = (allKeyDowns.length / totalTime) * 1000;
  }

  features.backspaceCount = keyDownEvents['Backspace']?.length || 0;

  const holdStats = calculateStatistics(features.holdTimes);
  const flightStats = calculateStatistics(features.flightTimes);
  const ddStats = calculateStatistics(features.downDownLatencies);

  const featureVector: number[] = [];
  featureVector.push(holdStats.mean, holdStats.standardDeviation, holdStats.median, holdStats.min, holdStats.max);
  featureVector.push(flightStats.mean, flightStats.standardDeviation, flightStats.median, flightStats.min, flightStats.max);
  featureVector.push(ddStats.mean, ddStats.standardDeviation, ddStats.median, ddStats.min, ddStats.max);
  featureVector.push(features.typingSpeed, features.backspaceCount);

  const captureTimespan =
    allKeyDowns.length > 0
      ? allKeyDowns[allKeyDowns.length - 1].timestamp - allKeyDowns[0].timestamp
      : 0;

  return {
    rawFeatures: features,
    statistics: {
      holdTimes: holdStats,
      flightTimes: flightStats,
      downDownLatencies: ddStats,
    },
    featureVector,
    totalKeystrokes: allKeyDowns.length,
    captureTimespan,
  };
}

export interface HomePageProps {
  isInWorldApp?: boolean;
  onVerifyMiniKit?: () => Promise<void>;
  isVerified: boolean;
  worldIdProof: ISuccessResult | null;
  worldIdError: IErrorState | null;
  worldIdLoading: boolean;
  onWorldIdVerify: (proof: ISuccessResult) => Promise<void>;
  onWorldIdError: (error: IErrorState) => void;
  onWorldIdReset: () => void;
  /** When true (e.g. from /write route), scroll the writing block into view after mount. */
  focusWriting?: boolean;
}

function HomePage({
  isInWorldApp = false,
  onVerifyMiniKit,
  isVerified,
  worldIdProof,
  worldIdError,
  worldIdLoading,
  onWorldIdVerify,
  onWorldIdError,
  onWorldIdReset,
  focusWriting = false,
}: HomePageProps) {
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
  /** Transient line after copy / open share targets */
  const [shareNote, setShareNote] = useState<string | null>(null);
  /** Whether the fullscreen writing overlay is open. */
  const [isWritingOpen, setIsWritingOpen] = useState<boolean>(false);
  /** Random phrase displayed during on-chain submit. Picked once per attempt
   *  so the user sees a single calm message instead of a flicker of stages. */
  const [submitPhrase, setSubmitPhrase] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const writingSectionRef = useRef<HTMLDivElement>(null);

  /** Keystroke events accumulated across pause/resume within this session. */
  const sessionKeystrokesRef = useRef<KeystrokeEvent[]>([]);
  /** Wall-clock pause windows for the current session — gap-stripped at feature extraction. */
  const pauseWindowsRef = useRef<PauseWindow[]>([]);

  const {
    startCapture,
    stopCapture,
    getRawKeystrokeData,
    getTabAwayCount,
    resetCapture,
    isCapturing,
  } = useKeystrokeCapture();
  const { generateHumanSignatureHash } = useBiometricProcessor();
  const humanFocusScore = humanFocusScoreFromTabAwayCount(sessionTabAwayCount);
  const { wallets } = useWallets();

  // ─── Capture lifecycle helpers ─────────────────────────────────────────
  const snapshotHookBuffer = useCallback(() => {
    const buf = getRawKeystrokeData();
    if (buf.length > 0) {
      sessionKeystrokesRef.current = sessionKeystrokesRef.current.concat(buf);
    }
  }, [getRawKeystrokeData]);

  const handlePauseCapture = () => {
    if (!isCapturing) return;
    snapshotHookBuffer();
    pauseWindowsRef.current.push({ startedAt: Date.now(), endedAt: 0 });
    stopCapture();
  };

  const handleResumeCapture = () => {
    if (isCapturing || !textareaRef.current) return;
    const open = pauseWindowsRef.current[pauseWindowsRef.current.length - 1];
    if (open && open.endedAt === 0) {
      open.endedAt = Date.now();
    }
    startCapture(textareaRef.current);
  };

  // ─── Cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (isCapturing) stopCapture();
    };
  }, [isCapturing, stopCapture]);

  // ─── Scroll into view when arriving at /write ──────────────────────────
  useEffect(() => {
    if (!focusWriting || !writingSectionRef.current) return;
    const el = writingSectionRef.current;
    const id = window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [focusWriting]);

  // ─── Hash + signature generation ───────────────────────────────────────
  const handleGenerateSignature = async (): Promise<{
    humanHash: string;
    textHash: string;
    biometric: DetailedBiometricData;
  } | null> => {
    if (!textareaRef.current) return null;

    setIsProcessing(true);
    setProcessingStatus('Processing keystroke data...');

    try {
      if (isCapturing) {
        snapshotHookBuffer();
        stopCapture();
      }

      const tabAwayCount = getTabAwayCount();
      const rawKeystrokeData = sessionKeystrokesRef.current.slice();

      if (rawKeystrokeData.length === 0) {
        setProcessingStatus('No keystroke data captured. Please type something first, then try again.');
        setIsProcessing(false);
        return null;
      }
      if (rawKeystrokeData.length < 10) {
        setProcessingStatus(
          `Only ${rawKeystrokeData.length} keystroke events captured. Please type more content for better analysis.`
        );
        setIsProcessing(false);
        return null;
      }

      setProcessingStatus('Extracting detailed biometric features...');
      const detailedFeatures = extractDetailedFeatures(rawKeystrokeData, pauseWindowsRef.current);
      setBiometricData(detailedFeatures);
      setSessionTabAwayCount(tabAwayCount);

      if (detailedFeatures.featureVector.length === 0) {
        setProcessingStatus('Failed to extract biometric features. Please try typing again.');
        setIsProcessing(false);
        return null;
      }

      setProcessingStatus('Generating human signature hash...');
      const humanHash = await generateHumanSignatureHash(detailedFeatures.featureVector);
      setHumanSignatureHash(humanHash);

      setProcessingStatus('Generating content hash...');
      const textHash = await hashContent(content);
      setContentHash(textHash);

      setProcessingStatus('Processing complete! Both hashes generated successfully.');
      resetCapture();
      return { humanHash, textHash, biometric: detailedFeatures };
    } catch (error) {
      console.error('Error processing biometric data:', error);
      setProcessingStatus(
        `Error processing biometric data: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`
      );
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  // ─── Paste prevention ──────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const currentValue = content;
    const lengthDifference = newValue.length - currentValue.length;
    if (lengthDifference > 5) {
      e.preventDefault();
      setProcessingStatus(
        '⚠️ Large text insertion (possible paste). Type manually to keep your biometric signature valid.'
      );
      return;
    }
    setContent(newValue);
  };

  // ─── Blockchain submit ─────────────────────────────────────────────────
  const handleSubmitToBlockchain = async (override?: {
    contentHash: string;
    humanSignatureHash: string;
    biometric: DetailedBiometricData;
  }) => {
    const effectiveContentHash = override?.contentHash ?? contentHash;
    const effectiveHumanSignatureHash = override?.humanSignatureHash ?? humanSignatureHash;
    const effectiveBiometric = override?.biometric ?? biometricData;

    if (!effectiveHumanSignatureHash || !effectiveContentHash) {
      setProcessingStatus('⚠️ Please sign your manuscript and generate a content hash before you publish to World Chain.');
      return;
    }
    if (!effectiveBiometric) {
      setProcessingStatus('⚠️ No biometric data available. Please capture keystrokes first.');
      return;
    }

    setIsSubmittingToBlockchain(true);
    setBlockchainErrorHelp(null);
    setBlockchainSuccess(null);
    setSubmitPhrase(pickSubmitPhrase());
    setProcessingStatus('');

    try {
      const submissionData = {
        contentHash: effectiveContentHash,
        humanSignatureHash: effectiveHumanSignatureHash,
        keystrokeCount: effectiveBiometric.totalKeystrokes,
        typingSpeed: effectiveBiometric.rawFeatures.typingSpeed,
        worldIdNullifier: isVerified ? worldIdProof?.nullifier_hash : undefined,
      };

      // Stage label is intentionally minimal — the prominent UI shows the
      // submitPhrase; processingStatus is reserved for surfacing errors.

      let privySigner: ethers.Signer | undefined;
      let privyAddress: string | undefined;
      if (wallets && wallets.length > 0) {
        // Explicitly pick the Privy embedded wallet so MetaMask can't hijack the tx.
        const wallet = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];
        privyAddress = wallet.address;
        const ethereumProvider = await wallet.getEthereumProvider();
        const provider = new ethers.BrowserProvider(ethereumProvider as any);
        privySigner = await provider.getSigner();
      }

      const result = await blockchainService.submitContent(submissionData, {
        // Drop the verbose stage messages on the floor; the loading UI shows
        // a single calm phrase. Console still gets them via blockchain.ts logs.
        onProgress: () => {},
        privySigner,
        privyAddress,
      });

      if (result.success && result.transactionHash) {
        setBlockchainErrorHelp(null);
        setSubmitPhrase(null);
        setBlockchainSuccess({
          transactionHash: result.transactionHash,
          entryId: result.entryId,
          gasUsed: result.gasUsed,
          explorerTxUrl: result.explorerTxUrl,
          explorerContractUrl: result.explorerContractUrl,
          explorerAddressUrl: result.explorerAddressUrl,
          statusNote: result.statusNote,
        });
        setProcessingStatus('');

        if (result.walletAddress) {
          // Remember the MiniKit wallet for future surfaces that need an identity.
          rememberMiniKitWallet(result.walletAddress);
        }
      } else {
        setSubmitPhrase(null);
        setProcessingStatus(
          result.quietUi
            ? result.error || 'Could not confirm. You can try again in a few seconds.'
            : `${result.error || 'Unknown blockchain error'}`
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
      setSubmitPhrase(null);
      setProcessingStatus(
        `Could not publish to World Chain: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsSubmittingToBlockchain(false);
    }
  };

  /** One-tap Sign + Publish. */
  const handlePost = async () => {
    if (!content.trim()) {
      setProcessingStatus('⚠️ Type something before posting.');
      return;
    }
    const signed = await handleGenerateSignature();
    if (!signed) return;
    await handleSubmitToBlockchain({
      contentHash: signed.textHash,
      humanSignatureHash: signed.humanHash,
      biometric: signed.biometric,
    });
  };

  // ─── Overlay open/close ────────────────────────────────────────────────
  const handleOpenWriting = () => {
    setIsWritingOpen(true);
  };

  const handleCloseWriting = () => {
    if (isCapturing) {
      snapshotHookBuffer();
      stopCapture();
    }
    setIsWritingOpen(false);
  };

  /** "Write another" from the receipt — reset every piece of session state. */
  const handleWriteAnother = () => {
    setContent('');
    setHumanSignatureHash('');
    setContentHash('');
    setBiometricData(null);
    setSessionTabAwayCount(0);
    setProcessingStatus('');
    setBlockchainErrorHelp(null);
    setBlockchainSuccess(null);
    setShareNote(null);
    sessionKeystrokesRef.current = [];
    pauseWindowsRef.current = [];
    resetCapture();
    setIsWritingOpen(false);
  };

  // ─── Body class toggle so AmbientNav can hide via pure CSS ─────────────
  useEffect(() => {
    if (isWritingOpen || blockchainSuccess) {
      document.body.classList.add('hi-overlay-open');
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.classList.remove('hi-overlay-open');
        document.body.style.overflow = prev;
      };
    }
    return undefined;
  }, [isWritingOpen, blockchainSuccess]);

  // ─── Open: reset state and auto-start capture ──────────────────────────
  useEffect(() => {
    if (!isWritingOpen) return;
    if (!textareaRef.current) return;
    if (isCapturing) return;
    if (content.trim() || sessionKeystrokesRef.current.length > 0) return;

    resetCapture();
    setHumanSignatureHash('');
    setContentHash('');
    setBiometricData(null);
    setSessionTabAwayCount(0);
    setProcessingStatus('');
    sessionKeystrokesRef.current = [];
    pauseWindowsRef.current = [];
    startCapture(textareaRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWritingOpen]);

  // ─── Auto-open the overlay when arriving at /write already verified ────
  useEffect(() => {
    if (!focusWriting) return;
    if (!isVerified) return;
    if (blockchainSuccess) return;
    if (!isWritingOpen) handleOpenWriting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusWriting, isVerified]);

  // ─── Reusable biometric detail block (inside receipt's <details>) ──────
  const biometricDetail = (
    <>
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
                  <tr className="hi-bio__row-section"><td colSpan={2}>Session</td></tr>
                  <tr className="hi-bio__row-focus-score">
                    <td>Human focus score (0–100)</td>
                    <td>
                      <span className="hi-bio__focus-num">{humanFocusScore}</span>
                      <span className="hi-bio__focus-denom"> / 100</span>
                      <p className="hi-bio__focus-copy">
                        Only the <strong>tab / window leave</strong> count, −{HUMAN_FOCUS_SCORE_POINTS_OFF_PER_LEAVE} points
                        per leave. Typing in this view is the baseline. Hold, flight, and speed below are for the hash, not
                        this score.
                      </p>
                    </td>
                  </tr>
                  <tr><td>Tab or window leaves in session</td><td>{sessionTabAwayCount}×</td></tr>
                  <tr><td>Keystrokes</td><td>{biometricData.totalKeystrokes}</td></tr>
                  <tr><td>Duration</td><td>{(biometricData.captureTimespan / 1000).toFixed(2)} s</td></tr>
                  <tr><td>Typing speed</td><td>{biometricData.rawFeatures.typingSpeed.toFixed(2)} c/s</td></tr>
                  <tr><td>Backspace</td><td>{biometricData.rawFeatures.backspaceCount}</td></tr>
                  <tr className="hi-bio__row-section"><td colSpan={2}>Hold times (dwell)</td></tr>
                  <tr className="hi-bio__row-hint"><td colSpan={2}><span>Key hold duration (down → up)</span></td></tr>
                  <BiometricTimingRows s={biometricData.statistics.holdTimes} />
                  <tr className="hi-bio__row-section"><td colSpan={2}>Flight times (inter-key)</td></tr>
                  <tr className="hi-bio__row-hint"><td colSpan={2}><span>Key release to next key press</span></td></tr>
                  <BiometricTimingRows s={biometricData.statistics.flightTimes} />
                  <tr className="hi-bio__row-section"><td colSpan={2}>Down-down (digraph)</td></tr>
                  <tr className="hi-bio__row-hint"><td colSpan={2}><span>Time between consecutive key presses</span></td></tr>
                  <BiometricTimingRows s={biometricData.statistics.downDownLatencies} />
                  <tr className="hi-bio__row-section"><td colSpan={2}>Feature vector (for hash)</td></tr>
                  <tr className="hi-bio__row-hint"><td colSpan={2}><span>Numeric pattern for this session</span></td></tr>
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
    </>
  );

  return (
    <>
      {/* ─── Stages: verify → start ─────────────────────────────────────── */}
      {!isWritingOpen && !blockchainSuccess && (
        <>
          <section className="hi-stage" ref={writingSectionRef}>
            <div className="hi-stage-card">
              {!isVerified ? (
                <>
                  <h2 className="hi-stage-card__title">Verify with World ID</h2>
                  <p className="hi-stage-card__sub">
                    Prove you’re a real person before we open your protected writing surface.
                  </p>
                  <div className="hi-stage-card__widget">
                    <WorldIDWidget
                      isVerified={isVerified}
                      worldIdProof={worldIdProof}
                      error={worldIdError}
                      isLoading={worldIdLoading}
                      onVerify={onWorldIdVerify}
                      onError={onWorldIdError}
                      onVerifyMiniKit={onVerifyMiniKit}
                      isInWorldApp={isInWorldApp}
                      layout="onboarding"
                    />
                  </div>
                </>
              ) : (
                <>
                  <span className="hi-stage-card__check" aria-hidden>✓</span>
                  <h2 className="hi-stage-card__title">You’re verified</h2>
                  <p className="hi-stage-card__sub">
                    Start writing to open the protected workspace. Your typing rhythm and content will be bound together
                    and posted onchain when you tap Post.
                  </p>
                  <button
                    type="button"
                    className="hi-btn hi-btn--session"
                    onClick={handleOpenWriting}
                    disabled={isProcessing}
                  >
                    Start writing
                  </button>
                  <p className="hi-stage-card__foot">
                    Biometric data never leaves your device. Copy and paste are off in the writing surface so the
                    signature reflects only what you type.
                  </p>
                </>
              )}
            </div>
          </section>

          <div className="hi-page-tldr">
            <h2 className="hi-page-tldr__title">At a glance</h2>
            <ol className="hi-page-tldr__ol" aria-label="Steps on this page">
              <li>
                <div className="hi-page-tldr__body">
                  <span className="hi-page-tldr__head">Authenticate Identity</span>
                  <p className="hi-page-tldr__text">
                    Secure your session with a World ID check to instantly distinguish yourself from AI-generated content
                  </p>
                </div>
              </li>
              <li>
                <div className="hi-page-tldr__body">
                  <span className="hi-page-tldr__head">Generate Your Signature</span>
                  <p className="hi-page-tldr__text">
                    As you type, we analyze keystroke dynamics and session activity to create a unique biometric hash.
                    This also establishes your intellectual property.
                  </p>
                </div>
              </li>
              <li>
                <div className="hi-page-tldr__body">
                  <span className="hi-page-tldr__head">Certify on World Chain</span>
                  <p className="hi-page-tldr__text">
                    Claim your proof. This links your biometric signature to your World ID, giving you a verifiable, onchain
                    record of your unique piece of writing.
                  </p>
                </div>
              </li>
            </ol>
            <p className="hi-page-tldr__privacy hi-page-tldr__privacy--compact">
              <Link to="/workflow">How it works</Link>
              <span className="hi-page-tldr__privacy-hint"> · data boundary, end-to-end flow, storage, contract</span>
            </p>
          </div>
        </>
      )}

      {/* ─── Stage: fullscreen writing overlay ──────────────────────────── */}
      {isWritingOpen && !blockchainSuccess && (
        <div className="hi-overlay" role="dialog" aria-label="Protected writing workspace">
          <div className="hi-overlay__topbar" role="toolbar" aria-label="Workspace actions">
            <button
              type="button"
              className="hi-overlay__close"
              onClick={handleCloseWriting}
              aria-label="Close workspace"
            >
              ×
            </button>
            <div className="hi-overlay__meta" aria-live="polite">
              {isCapturing && (
                <span className="hi-overlay__rec" title="Capture is active">
                  <span className="hi-overlay__rec-dot" aria-hidden />
                  Recording
                </span>
              )}
              {!isCapturing && sessionKeystrokesRef.current.length > 0 && (
                <span className="hi-overlay__paused-pill" title="Capture is paused">
                  Paused
                </span>
              )}
            </div>
            <div className="hi-overlay__actions">
              {isCapturing ? (
                <button
                  type="button"
                  className="hi-btn hi-btn--ghost"
                  onClick={handlePauseCapture}
                  disabled={isProcessing || isSubmittingToBlockchain}
                >
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  className="hi-btn hi-btn--ghost"
                  onClick={handleResumeCapture}
                  disabled={isProcessing || isSubmittingToBlockchain}
                >
                  Resume
                </button>
              )}
              <button
                type="button"
                className="hi-btn hi-btn--primary"
                onClick={handlePost}
                disabled={isProcessing || isSubmittingToBlockchain || !content.trim()}
              >
                {isProcessing ? 'Signing…' : isSubmittingToBlockchain ? 'Publishing…' : 'Post'}
              </button>
            </div>
          </div>

          <div className="hi-overlay__body">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleInputChange}
              disabled={!isCapturing}
              aria-label="Protected workspace: type to capture keystrokes for your biometric signature"
              title={!isCapturing ? 'Resume the protected session to keep typing' : undefined}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                const newValue = target.value;
                if (newValue.length - content.length > 5) {
                  target.value = content;
                  setProcessingStatus(
                    '⚠️ Large text insertion (possible paste). Type manually to keep your biometric signature valid.'
                  );
                }
              }}
              onPaste={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setProcessingStatus('⚠️ Use the keyboard only here. Paste and copy are off so your biometric signature stays valid.');
              }}
              onCopy={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setProcessingStatus('⚠️ Use the keyboard only here. Copy is off in this field so the signature matches what you type.');
              }}
              onCut={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setProcessingStatus('⚠️ Use the keyboard only here. Cut is off in this field so the signature matches what you type.');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setProcessingStatus('⚠️ Drop is disabled. Type in this field so your biometric signature is calibrated to real keystrokes.');
              }}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setProcessingStatus('⚠️ Right-click is disabled in this field to protect your signature calibration.');
              }}
              onKeyDown={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  if (e.key === 'v' || e.key === 'c' || e.key === 'x' || e.key === 'a') {
                    e.preventDefault();
                    e.stopPropagation();
                    setProcessingStatus(
                      '⚠️ Copy/paste shortcuts are off in this field so the biometric record matches manual typing only.'
                    );
                  }
                }
              }}
              placeholder={
                isCapturing
                  ? 'Start writing. Your rhythm shapes your unique biometric hash.'
                  : 'Tap Resume to keep typing in your protected session.'
              }
              className="hi-overlay__textarea"
            />

            {/* Clean loading state during submit: one short randomized phrase,
                no emoji, Space Grotesk. Replaces the verbose stage messages. */}
            {(isSubmittingToBlockchain || isProcessing) && submitPhrase && (
              <div className="hi-submit-loading" role="status" aria-live="polite">
                <span className="hi-submit-loading__dot" aria-hidden />
                <span className="hi-submit-loading__text">{submitPhrase}…</span>
              </div>
            )}

            {/* Show the raw status block only when NOT mid-submit — so paste
                warnings and error details surface, but the loud "Status: …"
                bar doesn't compete with the loading state. */}
            {!isSubmittingToBlockchain && !isProcessing && processingStatus && (
              <div className="hi-overlay__status">
                {processingStatus}
                {blockchainErrorHelp?.explorerAddressUrl && (
                  <div className="hi-blockchain-help" style={{ marginTop: 12, fontSize: 14 }}>
                    <p style={{ margin: '0 0 6px' }}>
                      <a href={blockchainErrorHelp.explorerAddressUrl} target="_blank" rel="noopener noreferrer">
                        Open your address on the block explorer
                      </a>
                    </p>
                    <p style={{ margin: '0 0 4px' }} className="hi-muted">
                      If the explorer does not open (common inside in-app browsers), copy this URL:
                    </p>
                    <code className="hi-code-inline">{blockchainErrorHelp.explorerAddressUrl}</code>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Stage: receipt (fullscreen overlay, swap of writing view) ──── */}
      {blockchainSuccess && (
        <div className="hi-overlay" role="dialog" aria-label="Submission receipt">
          <div className="hi-overlay__topbar" role="toolbar" aria-label="Receipt actions">
            <button
              type="button"
              className="hi-overlay__close"
              onClick={handleWriteAnother}
              aria-label="Close receipt"
            >
              ×
            </button>
            <div className="hi-overlay__meta" />
            <div className="hi-overlay__actions">
              <button
                type="button"
                className="hi-btn hi-btn--ghost"
                onClick={handleWriteAnother}
              >
                Write another
              </button>
            </div>
          </div>

          <div className="hi-overlay__body hi-overlay__body--centered">
            <div className="hi-receipt">
              <h2 className="hi-receipt__title">
                Submitted onchain
                {typeof blockchainSuccess.entryId === 'number' && (
                  <span className="hi-receipt__entry"> · Entry #{blockchainSuccess.entryId}</span>
                )}
              </h2>
              {blockchainSuccess.statusNote && (
                <p className="hi-receipt__note">{blockchainSuccess.statusNote}</p>
              )}
              <div className="hi-receipt__tx">
                <span className="hi-receipt__tx-label">Tx hash</span>
                <code className="hi-receipt__tx-hash">{blockchainSuccess.transactionHash}</code>
                <button
                  type="button"
                  className="hi-btn hi-btn--link hi-receipt__copy"
                  onClick={() => {
                    navigator.clipboard?.writeText(blockchainSuccess.transactionHash);
                    setShareNote('Tx hash copied.');
                    window.setTimeout(() => setShareNote(null), 3000);
                  }}
                >
                  Copy
                </button>
              </div>

              <div className="hi-receipt__actions" role="group" aria-label="Share attestation">
                {blockchainSuccess.explorerTxUrl && (
                  <a
                    href={blockchainSuccess.explorerTxUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hi-btn hi-btn--primary"
                  >
                    View transaction
                  </a>
                )}
                {blockchainSuccess.explorerContractUrl && (
                  <a
                    href={blockchainSuccess.explorerContractUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hi-btn hi-btn--ghost"
                  >
                    Open contract
                  </a>
                )}
                <button
                  type="button"
                  className="hi-btn"
                  onClick={() => {
                    const { text, truncated } = buildAttestationShareForX(
                      content,
                      blockchainSuccess.transactionHash,
                      blockchainSuccess.explorerTxUrl
                    );
                    window.open(xIntentUrl(text), '_blank', 'noopener,noreferrer');
                    setShareNote(
                      truncated
                        ? 'Opened X. Post was shortened to fit; use “Copy all” for the full text and link.'
                        : 'Opened X with your text and the onchain line.'
                    );
                    window.setTimeout(() => setShareNote(null), 6000);
                  }}
                >
                  Post on X
                </button>
                <button
                  type="button"
                  className="hi-btn"
                  onClick={async () => {
                    const full = buildAttestationShareBody(
                      content,
                      blockchainSuccess.transactionHash,
                      blockchainSuccess.explorerTxUrl
                    );
                    try {
                      await navigator.clipboard.writeText(full);
                      window.open(LINKEDIN_FEED_URL, '_blank', 'noopener,noreferrer');
                      setShareNote('Copied. Paste into the LinkedIn post box (tab just opened).');
                    } catch {
                      setShareNote('Could not copy. Try “Copy all” or allow clipboard access for this site.');
                    }
                    window.setTimeout(() => setShareNote(null), 6000);
                  }}
                >
                  Post on LinkedIn
                </button>
                <button
                  type="button"
                  className="hi-btn hi-btn--ghost hi-btn--sm"
                  onClick={async () => {
                    const full = buildAttestationShareBody(
                      content,
                      blockchainSuccess.transactionHash,
                      blockchainSuccess.explorerTxUrl
                    );
                    try {
                      await navigator.clipboard.writeText(full);
                      setShareNote('Copied to clipboard.');
                    } catch {
                      setShareNote('Copy failed. Your browser may block the clipboard in this view.');
                    }
                    window.setTimeout(() => setShareNote(null), 5000);
                  }}
                >
                  Copy all
                </button>
              </div>

              {shareNote && (
                <p className="hi-receipt__toast" role="status">
                  {shareNote}
                </p>
              )}

              <details className="hi-receipt__detail">
                <summary>Full detail · biometric, hashes, gas</summary>
                {blockchainSuccess.gasUsed && (
                  <p className="hi-receipt__gas">
                    <strong>Gas used:</strong> {blockchainSuccess.gasUsed}
                  </p>
                )}
                {biometricDetail}
              </details>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default HomePage;
