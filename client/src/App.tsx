import React, { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './App.css';
import OnboardingFlow, { isOnboardingMarkedDone } from './components/OnboardingFlow';
import { useWorldID } from './hooks/useWorldID';
import { useMiniKit } from './hooks/useMiniKit';
import AppLayout from './layouts/AppLayout';
import HomePage from './pages/HomePage';
import MyContentPage from './pages/MyContentPage';
import FeedPage from './pages/FeedPage';
import WorkflowPage from './pages/WorkflowPage';

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

  if (onboardingOpen) {
    return (
      <div className="App">
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
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="App">
        <Routes>
          <Route element={<AppLayout />}>
            <Route
              path="/"
              element={
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
                />
              }
            />
            <Route path="/workflow" element={<WorkflowPage />} />
            <Route path="/feed" element={<FeedPage />} />
            <Route path="/my-content" element={<MyContentPage />} />
            <Route path="/ledger" element={<Navigate to="/my-content" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
