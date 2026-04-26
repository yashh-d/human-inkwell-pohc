import { useCallback } from 'react';

interface KeystrokeEvent {
  key: string;
  eventType: 'keydown' | 'keyup';
  timestamp: number;
}

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

export const useBiometricProcessor = () => {
  const calculateStatistics = useCallback((values: number[]): FeatureStatistics => {
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
  }, []);

  const extractFeatures = useCallback((rawKeystrokeData: KeystrokeEvent[]): number[] => {
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

    // Generate feature vector from statistics
    const featureVector: number[] = [];
    
    // Hold times statistics
    const holdStats = calculateStatistics(features.holdTimes);
    featureVector.push(holdStats.mean, holdStats.standardDeviation, holdStats.median, holdStats.min, holdStats.max);
    
    // Flight times statistics
    const flightStats = calculateStatistics(features.flightTimes);
    featureVector.push(flightStats.mean, flightStats.standardDeviation, flightStats.median, flightStats.min, flightStats.max);
    
    // Down-down latencies statistics
    const ddStats = calculateStatistics(features.downDownLatencies);
    featureVector.push(ddStats.mean, ddStats.standardDeviation, ddStats.median, ddStats.min, ddStats.max);
    
    // Additional features
    featureVector.push(features.typingSpeed, features.backspaceCount);

    return featureVector;
  }, [calculateStatistics]);

  const generateHumanSignatureHash = useCallback(async (featureVector: number[]): Promise<string> => {
    // Convert feature vector to consistent binary representation
    const float64Array = new Float64Array(featureVector);
    const binaryData = float64Array.buffer;
    
    // Generate SHA-256 hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', binaryData);
    
    // Convert to hexadecimal string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex;
  }, []);

  return {
    extractFeatures,
    generateHumanSignatureHash
  };
}; 