import React, { useCallback, useEffect, useRef } from 'react';
import { ISuccessResult, IErrorState } from '@worldcoin/idkit';
import WorldIDWidget from './WorldIDWidget';
import PoweredByWorld from './PoweredByWorld';
import './OnboardingFlow.css';

export const HUMAN_INKWELL_ONBOARDING_STORAGE_KEY = 'humanInkwell_onboarding_v1';

export const isOnboardingMarkedDone = (): boolean => {
  try {
    return localStorage.getItem(HUMAN_INKWELL_ONBOARDING_STORAGE_KEY) === 'done';
  } catch {
    return false;
  }
};

export const markOnboardingDone = (): void => {
  try {
    localStorage.setItem(HUMAN_INKWELL_ONBOARDING_STORAGE_KEY, 'done');
  } catch {
    /* private mode */
  }
};

const SLIDES: { id: string; title: string; body: string[] }[] = [
  {
    id: 'what',
    title: 'What is Human Inkwell?',
    body: [
      'To prove you wrote it and help establish IP, all processing is local: you type, we measure key-level timing (hold, flight, down–down) and a small amount of session context (for example, how often this tab was hidden). That becomes a compact signature and content hashes. Nothing is streamed to us as raw keylogs.',
      'You can tie a record to your wallet—and with World ID, add proof of personhood.',
    ],
  },
  {
    id: 'why',
    title: 'Why use it?',
    body: [
      'Privacy: your exact words are not put on chain—only hashes and metrics.',
      'Trust: you bind your writing to a human signal and a verifiable onchain attestation on the Human Content Ledger.',
    ],
  },
  {
    id: 'how',
    title: 'How it works',
    body: [
      'Type naturally (paste is off so the signal is real). Start a session, write in the field, and we will include focus events—tab or window changes counted locally, not tracked as browsing history.',
      'Connect your wallet and submit to the contract when you are ready.',
    ],
  },
];

const LAST_STEP = 3;

type WorldIDWidgetBridgeProps = {
  isVerified: boolean;
  worldIdProof: ISuccessResult | null;
  error: IErrorState | null;
  isLoading: boolean;
  onVerify: (proof: ISuccessResult) => Promise<void>;
  onError: (error: IErrorState) => void;
  /** MiniKit native verify handler */
  onVerifyMiniKit?: () => Promise<void>;
  /** Whether running inside World App */
  isInWorldApp?: boolean;
};

type OnboardingFlowProps = {
  worldIdProps: WorldIDWidgetBridgeProps;
  onComplete: () => void;
};

const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ worldIdProps, onComplete }) => {
  const [step, setStep] = React.useState(0);
  const completedRef = useRef(false);

  const { isVerified } = worldIdProps;

  const completeOnboarding = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    markOnboardingDone();
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    if (step === LAST_STEP && isVerified) {
      completeOnboarding();
    }
  }, [step, isVerified, completeOnboarding]);

  const goNext = useCallback(() => {
    if (step < LAST_STEP) {
      setStep((s) => s + 1);
    }
  }, [step]);

  const goBack = useCallback(() => {
    if (step > 0) {
      setStep((s) => s - 1);
    }
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && !e.altKey && !e.metaKey) {
        if (step < LAST_STEP) {
          goNext();
        }
      } else if (e.key === 'ArrowLeft' && !e.altKey && !e.metaKey) {
        goBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, goNext, goBack]);

  const slide = step < 3 ? SLIDES[step] : null;
  const isLastSlide = step === LAST_STEP;

  return (
    <div className="onboarding-root" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-card">
        <div className="onboarding-brand">
          <PoweredByWorld variant="header" className="onboarding-brand__powered" rootId="onboarding-title" />
        </div>

        <div className="onboarding-dots" role="tablist" aria-label="Onboarding steps">
          {[0, 1, 2, 3].map((i) => (
            <button
              key={i}
              type="button"
              aria-label={`Step ${i + 1} of 4`}
              aria-current={step === i}
              onClick={() => setStep(i)}
            />
          ))}
        </div>

        <div className="onboarding-slide">
          {slide && (
            <div className="onboarding-slide-panel">
              <h2>{slide.title}</h2>
              {slide.body.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          )}

          {isLastSlide && (
            <div className="onboarding-slide-panel onboarding-world-wrap">
              <h2>Connect World ID to your writing</h2>
              <p>
                Human Inkwell is about <strong>content</strong> you type yourself: key timing, coarse session context
                (e.g. page activity), hashes, and optional onchain attestation. World ID ties{' '}
                <strong>proof of personhood</strong> to that work—your writing session is linked to one real human, so
                it isn’t interchangeable with a bot or anonymous AI output.
              </p>
              <WorldIDWidget {...worldIdProps} layout="onboarding" />
            </div>
          )}
        </div>

        <div className="onboarding-nav">
          <button
            type="button"
            className="onboarding-btn onboarding-btn--ghost"
            onClick={goBack}
            disabled={step === 0}
          >
            Back
          </button>
          <div className="onboarding-nav-buttons">
            {isLastSlide && (
              <button type="button" className="onboarding-btn onboarding-btn--skip" onClick={completeOnboarding}>
                Continue without World ID
              </button>
            )}
            {step < 2 && (
              <button type="button" className="onboarding-btn onboarding-btn--primary" onClick={goNext}>
                Next
              </button>
            )}
            {step === 2 && (
              <button type="button" className="onboarding-btn onboarding-btn--primary" onClick={goNext}>
                Continue
              </button>
            )}
          </div>
        </div>
        <span className="onboarding-hint">Steps 1–3: use ← → keys to go back and forth</span>
      </div>
    </div>
  );
};

export default OnboardingFlow;
