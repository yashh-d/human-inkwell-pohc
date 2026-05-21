import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ISuccessResult, IErrorState } from '@worldcoin/idkit';
import { useKeystrokeCapture } from '../hooks/useKeystrokeCapture';
import { useBiometricProcessor } from '../hooks/useBiometricProcessor';
import { hashContent } from '../utils/crypto';
import { humanFocusScoreFromTabAwayCount, HUMAN_FOCUS_SCORE_POINTS_OFF_PER_LEAVE } from '../utils/humanFocusScore';
import {
  buildAttestationShareBody,
  buildAttestationShareForX,
  xIntentUrl,
  LINKEDIN_FEED_URL,
} from '../utils/socialShare';
import {
  saveDraft,
  loadDraft,
  clearDraft,
  type KeystrokeEvent as DraftKeystrokeEvent,
  type PauseWindow,
} from '../utils/drafts';
import { formatRelativeTime } from '../utils/relativeTime';
import WorldIDWidget from '../components/WorldIDWidget';
import { blockchainService } from '../blockchain';
import { pushLedgerIndexAfterOnChainSuccess } from '../ledgerSupabase';
import { useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';

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
  /** When true, send the typed text to the public feed API (server verifies it matches the onchain content hash). */
  const [publishTextToFeed, setPublishTextToFeed] = useState(true);
  /** Transient line after copy / open share targets */
  const [shareNote, setShareNote] = useState<string | null>(null);
  /** Whether the fullscreen writing overlay is open. Controls the staged UX. */
  const [isWritingOpen, setIsWritingOpen] = useState<boolean>(false);
  /** ISO timestamp of last autosave; powers the "Saved · 12s ago" indicator. */
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  /** Transient line under the overlay toolbar after restore/save events. */
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const writingSectionRef = useRef<HTMLDivElement>(null);
  /** Keystroke events captured before the current capture session (across pauses / restores). */
  const savedKeystrokesRef = useRef<DraftKeystrokeEvent[]>([]);
  /** Wall-clock pause windows for the current draft; gap-stripped at feature-extraction time. */
  const pauseWindowsRef = useRef<PauseWindow[]>([]);
  /** ms epoch of when capture first started for this draft; persisted alongside text. */
  const sessionStartedAtRef = useRef<number>(0);
  /** Debounce timer for the autosave effect. */
  const autosaveTimerRef = useRef<number | null>(null);

  const { startCapture, stopCapture, getRawKeystrokeData, getTabAwayCount, resetCapture, isCapturing } = useKeystrokeCapture();
  const { generateHumanSignatureHash } = useBiometricProcessor();
  const humanFocusScore = humanFocusScoreFromTabAwayCount(sessionTabAwayCount);
  const { wallets } = useWallets();
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

  // Function to extract detailed biometric features.
  //
  // pauseWindows: wall-clock (Date.now()) ranges during which capture was paused.
  // For each event timestamp `t`, we subtract the cumulative pause-duration of
  // every fully-elapsed pause window (pw.endedAt <= t), so a 12-hour pause
  // becomes a zero-ms gap in the feature vector. This keeps the hash representing
  // an unbroken typing rhythm even when the user resumed a draft hours later.
  const extractDetailedFeatures = (
    rawKeystrokeData: KeystrokeEvent[],
    pauseWindows: { startedAt: number; endedAt: number }[] = []
  ): DetailedBiometricData => {
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
      backspaceCount: 0
    };

    // Group events by key and timestamp for processing
    const keyDownEvents: { [key: string]: number[] } = {};
    const keyUpEvents: { [key: string]: number[] } = {};
    const allKeyDowns: { key: string; timestamp: number }[] = [];
    const allKeyUps: { key: string; timestamp: number }[] = [];

    normalizedEvents.forEach(event => {
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

  useEffect(() => {
    if (!focusWriting || !writingSectionRef.current) return;
    const el = writingSectionRef.current;
    const id = window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [focusWriting]);

  const handleStartCapture = () => {
    console.log('Manual start capture clicked');
    if (textareaRef.current) {
      resetCapture();
      setHumanSignatureHash('');
      setContentHash('');
      setBiometricData(null);
      setSessionTabAwayCount(0);
      setProcessingStatus('Ready to capture keystrokes...');
      // Fresh session = no prior keystrokes, no pauses, mark session start.
      savedKeystrokesRef.current = [];
      pauseWindowsRef.current = [];
      sessionStartedAtRef.current = Date.now();
      startCapture(textareaRef.current);
    }
  };

  /** Snapshot the hook's keystroke buffer into `savedKeystrokesRef` so we can
   *  resume capture later without losing pre-pause events. */
  const snapshotHookBuffer = () => {
    const buf = getRawKeystrokeData();
    if (buf.length > 0) {
      savedKeystrokesRef.current = savedKeystrokesRef.current.concat(buf);
    }
  };

  /** Pause keystroke capture. Keeps text + saved keystrokes; opens a new
   *  pause window. UI in the overlay toolbar flips Pause → Resume. */
  const handlePauseCapture = () => {
    if (!isCapturing) return;
    snapshotHookBuffer();
    pauseWindowsRef.current.push({ startedAt: Date.now(), endedAt: 0 });
    stopCapture();
  };

  /** Resume keystroke capture in the same draft. Closes the latest pause
   *  window and re-arms capture on the same textarea. */
  const handleResumeCapture = () => {
    if (isCapturing || !textareaRef.current) return;
    const open = pauseWindowsRef.current[pauseWindowsRef.current.length - 1];
    if (open && open.endedAt === 0) {
      open.endedAt = Date.now();
    }
    startCapture(textareaRef.current);
  };


  const handleGenerateSignature = async (): Promise<{
    humanHash: string;
    textHash: string;
    biometric: DetailedBiometricData;
  } | null> => {
    if (!textareaRef.current) return null;

    setIsProcessing(true);
    setProcessingStatus('Processing keystroke data...');

    try {
      // Capture is paused/stopped while we extract — snapshot first so the
      // current buffer is merged into savedKeystrokesRef before we read it.
      if (isCapturing) {
        snapshotHookBuffer();
        stopCapture();
      }

      const tabAwayCount = getTabAwayCount();

      // Combined keystroke data across pauses + resumes for this draft.
      const rawKeystrokeData = savedKeystrokesRef.current.slice();

      console.log('Raw keystroke data:', rawKeystrokeData, 'pauses:', pauseWindowsRef.current); // Debug log

      if (rawKeystrokeData.length === 0) {
        setProcessingStatus('No keystroke data captured. Please type something first, then try again.');
        setIsProcessing(false);
        return null;
      }

      if (rawKeystrokeData.length < 10) {
        setProcessingStatus(`Only ${rawKeystrokeData.length} keystroke events captured. Please type more content for better analysis.`);
        setIsProcessing(false);
        return null;
      }

      setProcessingStatus('Extracting detailed biometric features...');

      // Extract detailed biometric features — pass pauseWindows so gaps don't leak into the feature vector.
      const detailedFeatures = extractDetailedFeatures(rawKeystrokeData, pauseWindowsRef.current);
      setBiometricData(detailedFeatures);
      setSessionTabAwayCount(tabAwayCount);

      console.log('Detailed biometric features:', detailedFeatures); // Debug log

      if (detailedFeatures.featureVector.length === 0) {
        setProcessingStatus('Failed to extract biometric features. Please try typing again.');
        setIsProcessing(false);
        return null;
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

      return { humanHash, textHash, biometric: detailedFeatures };
    } catch (error) {
      console.error('Error processing biometric data:', error);
      setProcessingStatus(`Error processing biometric data: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`);
      return null;
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
      setProcessingStatus(
        '⚠️ Large text insertion (possible paste). Type manually to keep your biometric signature valid.',
      );
      return;
    }
    
    setContent(newValue);
  };

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
    setProcessingStatus('🔗 Connecting to wallet...');

    try {
      // Prepare submission data
      const submissionData = {
        contentHash: effectiveContentHash,
        humanSignatureHash: effectiveHumanSignatureHash,
        keystrokeCount: effectiveBiometric.totalKeystrokes,
        typingSpeed: effectiveBiometric.rawFeatures.typingSpeed,
        worldIdNullifier: isVerified ? worldIdProof?.nullifier_hash : undefined
      };

      console.log('🔒 Blockchain Submission Data:', submissionData);

      setProcessingStatus('⛓️ Publishing to World Chain (Human Content Ledger)…');
      
      let privySigner: ethers.Signer | undefined;
      let privyAddress: string | undefined;

      if (wallets && wallets.length > 0) {
        // Explicitly search for the Embedded Privy Wallet to prevent MetaMask from hijacking the transaction
        const wallet = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];
        privyAddress = wallet.address;
        const ethereumProvider = await wallet.getEthereumProvider();
        const provider = new ethers.BrowserProvider(ethereumProvider as any);
        privySigner = await provider.getSigner();
      }

      // Submit to blockchain (progress + long onchain wait happen inside; avoids false "0 gas" errors on first try)
      const result = await blockchainService.submitContent(submissionData, {
        onProgress: (msg) => {
          setProcessingStatus(msg);
        },
        privySigner,
        privyAddress,
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
        setProcessingStatus('✅ Published to World Chain (Human Content Ledger).');
        console.log('🎉 Blockchain submission successful!', result);
        // The chain entry is now the source of truth — discard the local draft.
        clearDraft();
        setLastSavedAt(null);

        if (result.entryId != null && result.walletAddress) {
          try {
            await pushLedgerIndexAfterOnChainSuccess(result, {
              contentHash: effectiveContentHash,
              humanSignatureHash: effectiveHumanSignatureHash,
              keystrokeCount: effectiveBiometric.totalKeystrokes,
              typingSpeed: effectiveBiometric.rawFeatures.typingSpeed,
              isVerified,
              worldIdNullifier: worldIdProof?.nullifier_hash,
              authorAddress: result.walletAddress,
              publicText: publishTextToFeed ? content : undefined,
            });
          } catch (e) {
            console.warn('Off-chain feed index (Supabase) failed:', e);
          }
        }
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
      setProcessingStatus(
        `❌ Could not publish to World Chain: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      setIsSubmittingToBlockchain(false);
    }
  };

  /** One-tap Sign + Publish. Used by the overlay's Post button. Passes the
   *  freshly-computed hashes directly into the submit step to bypass React
   *  state-setter batching. */
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

  /** Open the fullscreen writing overlay AND start a fresh capture session. */
  const handleOpenWriting = () => {
    handleStartCapture();
    setIsWritingOpen(true);
  };

  /** "Write another" from the receipt: clear post-success state, clear draft,
   *  return to the Start stage (overlay closes, capture stopped, content empty). */
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
    setLastSavedAt(null);
    setDraftNote(null);
    savedKeystrokesRef.current = [];
    pauseWindowsRef.current = [];
    sessionStartedAtRef.current = 0;
    resetCapture();
    clearDraft();
    setIsWritingOpen(false);
  };

  // ─── Autosave (debounced) ──────────────────────────────────────────────
  // Save the in-progress draft to localStorage 1.5s after the last edit. We
  // persist content + keystroke events + pause windows + session-start time
  // so a refresh restores the full biometric context, not just the text.
  useEffect(() => {
    if (!isWritingOpen) return;
    if (!content.trim()) return; // nothing meaningful to save yet
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      // Snapshot the hook's buffer into savedKeystrokesRef without stopping capture,
      // so the save always reflects the full set of keystrokes typed so far.
      const liveBuffer = getRawKeystrokeData();
      const merged = savedKeystrokesRef.current.concat(liveBuffer);
      const saved = saveDraft({
        title: '',
        content,
        contentType: 'short',
        keystrokeEvents: merged,
        pauseWindows: pauseWindowsRef.current.slice(),
        sessionStartedAt: sessionStartedAtRef.current || Date.now(),
      });
      if (saved) {
        setLastSavedAt(saved.savedAt);
      }
    }, 1500);
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, isWritingOpen]);

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

  // ─── Draft restore when the overlay opens with an empty composer ───────
  useEffect(() => {
    if (!isWritingOpen) return;
    if (content.trim()) return; // don't clobber in-progress work
    const draft = loadDraft();
    if (!draft) return;
    setContent(draft.content);
    savedKeystrokesRef.current = draft.keystrokeEvents.slice();
    pauseWindowsRef.current = draft.pauseWindows.slice();
    sessionStartedAtRef.current = draft.sessionStartedAt;
    setLastSavedAt(draft.savedAt);
    setDraftNote(`Restored draft from ${formatRelativeTime(draft.savedAt)}`);
    window.setTimeout(() => setDraftNote(null), 4000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWritingOpen]);

  // ─── Auto-open the overlay when arriving at /write already verified ───
  useEffect(() => {
    if (!focusWriting) return;
    if (!isVerified) return;
    if (blockchainSuccess) return;
    if (!isWritingOpen) {
      handleOpenWriting();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusWriting, isVerified]);

  // ─── "Saved · 2m ago" indicator label, recomputed each render ──────────
  const savedRelativeLabel = useMemo(
    () => (lastSavedAt ? `Saved · ${formatRelativeTime(lastSavedAt)}` : null),
    [lastSavedAt]
  );


  // Reusable biometric detail block — rendered inside the receipt's <details>
  // and nowhere else. Same data, just moved out of the verify/start/writing
  // stages so they stay clean.
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
                    Start your protected session to open the writing workspace. Your typing rhythm and content will be
                    bound together and posted onchain when you tap Post.
                  </p>
                  <button
                    type="button"
                    className="hi-btn hi-btn--session"
                    onClick={handleOpenWriting}
                    disabled={isProcessing}
                  >
                    Start your protected session
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
              onClick={() => setIsWritingOpen(false)}
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
              {!isCapturing && savedKeystrokesRef.current.length > 0 && (
                <span className="hi-overlay__paused-pill" title="Capture is paused">
                  Paused
                </span>
              )}
              {savedRelativeLabel && (
                <span className="hi-overlay__save-ind" title={lastSavedAt || undefined}>
                  {savedRelativeLabel}
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

          {draftNote && (
            <p className="hi-overlay__draft-note" role="status">
              {draftNote}
            </p>
          )}

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
                    '⚠️ Large text insertion (possible paste). Type manually to keep your biometric signature valid.',
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
                      '⚠️ Copy/paste shortcuts are off in this field so the biometric record matches manual typing only.',
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

            <label className="hi-feed-publish hi-overlay__feed-publish">
              <input
                type="checkbox"
                checked={publishTextToFeed}
                onChange={(e) => setPublishTextToFeed(e.target.checked)}
              />
              <span>
                Post my text on the <Link to="/feed">public feed</Link>
              </span>
            </label>

            {processingStatus && (
              <div className="hi-overlay__status">
                <strong>Status:</strong> {processingStatus}
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
                        : 'Opened X with your text and the onchain line.',
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
                      blockchainSuccess.explorerTxUrl,
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
                      blockchainSuccess.explorerTxUrl,
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
