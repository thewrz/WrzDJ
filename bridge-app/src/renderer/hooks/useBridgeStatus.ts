import { useState, useEffect } from 'react';
import { api } from '../api.js';
import type { BridgeStatus } from '../../shared/types.js';

const INITIAL_STATUS: BridgeStatus = {
  isRunning: false,
  connectedDevice: null,
  eventCode: null,
  eventName: null,
  currentTrack: null,
  deckStates: [],
};

export function useBridgeStatus() {
  const [status, setStatus] = useState<BridgeStatus>(INITIAL_STATUS);

  useEffect(() => {
    const unsubscribe = api.onBridgeStatus((newStatus) => {
      setStatus(newStatus);
    });

    return unsubscribe;
  }, []);

  return status;
}
