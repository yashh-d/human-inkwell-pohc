import { useRef, useCallback, useState } from 'react';

interface KeystrokeEvent {
  key: string;
  eventType: 'keydown' | 'keyup';
  timestamp: number;
}

interface UseKeystrokeCaptureReturn {
  startCapture: (target: HTMLElement) => void;
  stopCapture: () => void;
  getRawKeystrokeData: () => KeystrokeEvent[];
  resetCapture: () => void;
  isCapturing: boolean;
}

export const useKeystrokeCapture = (): UseKeystrokeCaptureReturn => {
  const keystrokeDataRef = useRef<KeystrokeEvent[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const targetElementRef = useRef<HTMLElement | null>(null);
  const isCapturingRef = useRef(false);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!isCapturingRef.current) return;
    
    console.log('KeyDown captured:', event.key, 'at', performance.now());
    
    keystrokeDataRef.current.push({
      key: event.key,
      eventType: 'keydown',
      timestamp: performance.now()
    });
  }, []);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (!isCapturingRef.current) return;
    
    console.log('KeyUp captured:', event.key, 'at', performance.now());
    
    keystrokeDataRef.current.push({
      key: event.key,
      eventType: 'keyup',
      timestamp: performance.now()
    });
  }, []);

  const stopCapture = useCallback(() => {
    console.log('Stopping capture...');
    
    if (!isCapturingRef.current || !targetElementRef.current) {
      console.log('Not currently capturing or no target');
      return;
    }
    
    isCapturingRef.current = false;
    setIsCapturing(false);
    
    // Remove event listeners
    targetElementRef.current.removeEventListener('keydown', handleKeyDown);
    targetElementRef.current.removeEventListener('keyup', handleKeyUp);
    
    console.log('Capture stopped, listeners removed. Total events captured:', keystrokeDataRef.current.length);
    
    targetElementRef.current = null;
  }, [handleKeyDown, handleKeyUp]);

  const startCapture = useCallback((target: HTMLElement) => {
    console.log('Starting capture...');
    
    // Stop current capture if already capturing
    if (isCapturingRef.current && targetElementRef.current) {
      console.log('Already capturing, stopping first...');
      targetElementRef.current.removeEventListener('keydown', handleKeyDown);
      targetElementRef.current.removeEventListener('keyup', handleKeyUp);
    }
    
    targetElementRef.current = target;
    isCapturingRef.current = true;
    setIsCapturing(true);
    
    // Clear previous data
    keystrokeDataRef.current = [];
    
    // Add event listeners
    target.addEventListener('keydown', handleKeyDown);
    target.addEventListener('keyup', handleKeyUp);
    
    console.log('Capture started, listeners attached');
  }, [handleKeyDown, handleKeyUp]);

  const getRawKeystrokeData = useCallback(() => {
    console.log('Getting raw keystroke data, length:', keystrokeDataRef.current.length);
    return [...keystrokeDataRef.current];
  }, []);

  const resetCapture = useCallback(() => {
    console.log('Resetting capture data');
    keystrokeDataRef.current = [];
  }, []);

  return {
    startCapture,
    stopCapture,
    getRawKeystrokeData,
    resetCapture,
    isCapturing
  };
}; 