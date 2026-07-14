import React, { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import './App.css';
import OnboardingFlow, { isOnboardingMarkedDone } from './components/OnboardingFlow';
import { useWorldID } from './hooks/useWorldID';
import { useMiniKit } from './hooks/useMiniKit';
import AppLayout from './layouts/AppLayout';
import LandingPage from './pages/LandingPage';
import AboutPage from './pages/AboutPage';
import HomePage from './pages/HomePage';
import WorkflowPage from './pages/WorkflowPage';
import PublishProofPage from './pages/PublishProofPage';
import CreatorProofPage from './pages/CreatorProofPage';
import CreatorBadge from './pages/CreatorBadge';
import CreatorFeedPage from './pages/CreatorFeedPage';
import CreatorMePage from './pages/CreatorMePage';

/** Only mount when enabled so `/_vercel/insights/script.js` is not requested on hosts where it 404s as HTML. */
function VercelAnalyticsGate() {
  if (process.env.REACT_APP_ENABLE_VERCEL_ANALYTICS !== 'true') return null;
  return <Analytics />;
}

function App() {
  const [onboardingOpen, setOnboardingOpen] = useState(() => !isOnboardingMarkedDone());

  // MiniKit detection
  const { isInWorldApp } = useMiniKit();

  const {
    isVerified,
    worldIdProof,
    error: worldIdError,
    isLoading: worldIdLoading,
    handleVerify,
    handleError,
    verifyViaMiniKit,
    resetVerification,
  } = useWorldID();

  // Onboarding now gates only the app routes (not the marketing landing at /),
  // so a first-time visitor sees the homepage and meets onboarding when they
  // enter the app via a CTA. Rendered as the app layout's element with no
  // <Outlet/>, so child app routes stay hidden until onboarding completes.
  const onboardingEl = (
    <OnboardingFlow
      worldIdProps={{
        isVerified,
        worldIdProof,
        error: worldIdError,
        isLoading: worldIdLoading,
        onVerify: handleVerify,
        onError: handleError,
        onVerifyMiniKit: verifyViaMiniKit,
        isInWorldApp,
      }}
      onComplete={() => setOnboardingOpen(false)}
    />
  );

  const writeEl = (
    <HomePage
      isInWorldApp={isInWorldApp}
      onVerifyMiniKit={verifyViaMiniKit}
      isVerified={isVerified}
      worldIdProof={worldIdProof}
      worldIdError={worldIdError}
      worldIdLoading={worldIdLoading}
      onWorldIdVerify={handleVerify}
      onWorldIdError={handleError}
      onWorldIdReset={resetVerification}
      focusWriting
    />
  );

  return (
    <BrowserRouter>
      <div className="App">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/about" element={<AboutPage />} />
          {/* The badge must render bare (no app chrome) so it embeds cleanly in
              an <iframe>; it stays outside the app layout. */}
          <Route path="/badge" element={<CreatorBadge />} />
          <Route element={onboardingOpen ? onboardingEl : <AppLayout />}>
            <Route path="/write" element={writeEl} />
            <Route path="/workflow" element={<WorkflowPage />} />
            <Route path="/publish" element={<PublishProofPage />} />
            {/* Creator surfaces share the same chrome + report as /publish. */}
            <Route path="/creator" element={<CreatorProofPage />} />
            <Route path="/feed" element={<CreatorFeedPage />} />
            <Route path="/me" element={<CreatorMePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <VercelAnalyticsGate />
      </div>
    </BrowserRouter>
  );
}

export default App;
