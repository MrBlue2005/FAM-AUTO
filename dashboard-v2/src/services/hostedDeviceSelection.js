import { useState } from 'react';

export const DEVICE_PROFILE_READINESS = Object.freeze({
  NO_DEVICE: 'NO_DEVICE',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  NO_PROFILE: 'NO_PROFILE',
  PROFILE_NOT_READY: 'PROFILE_NOT_READY',
  READY_FOR_PREFLIGHT: 'READY_FOR_PREFLIGHT',
});

export function resolveHostedDeviceProfileSelection(devices, selection = {}) {
  const deviceId = String(selection.deviceId || '');
  const profileId = String(selection.profileId || '');
  const selectedDevice = (devices || []).find((device) => device.deviceId === deviceId) || null;
  if (!selectedDevice) return { selectedDeviceId: null, selectedProfileId: null, selectedDevice: null, selectedProfile: null, readiness: DEVICE_PROFILE_READINESS.NO_DEVICE };

  const selectedProfile = (selectedDevice.profiles || []).find((profile) => profile.profileId === profileId) || null;
  const validProfileId = selectedProfile ? profileId : null;
  if (!selectedDevice.online) return { selectedDeviceId: deviceId, selectedProfileId: validProfileId, selectedDevice, selectedProfile, readiness: DEVICE_PROFILE_READINESS.DEVICE_OFFLINE };
  if (!selectedProfile) return { selectedDeviceId: deviceId, selectedProfileId: null, selectedDevice, selectedProfile: null, readiness: DEVICE_PROFILE_READINESS.NO_PROFILE };
  if (!selectedProfile.ready) return { selectedDeviceId: deviceId, selectedProfileId: profileId, selectedDevice, selectedProfile, readiness: DEVICE_PROFILE_READINESS.PROFILE_NOT_READY };
  return { selectedDeviceId: deviceId, selectedProfileId: profileId, selectedDevice, selectedProfile, readiness: DEVICE_PROFILE_READINESS.READY_FOR_PREFLIGHT };
}

export function useHostedDeviceProfileSelection(devices) {
  const [selection, setSelection] = useState({ deviceId: null, profileId: null });
  const resolved = resolveHostedDeviceProfileSelection(devices, selection);

  function selectDevice(deviceId) {
    const device = (devices || []).find((item) => item.deviceId === deviceId);
    if (!device) return false;
    setSelection((current) => ({ deviceId, profileId: current.deviceId === deviceId && (device.profiles || []).some((profile) => profile.profileId === current.profileId) ? current.profileId : null }));
    return true;
  }

  function selectProfile(profileId) {
    const device = (devices || []).find((item) => item.deviceId === selection.deviceId);
    if (!device || !(device.profiles || []).some((profile) => profile.profileId === profileId)) return false;
    setSelection((current) => ({ ...current, profileId }));
    return true;
  }

  function clearSelection() {
    setSelection({ deviceId: null, profileId: null });
  }

  return { ...resolved, selectDevice, selectProfile, clearSelection };
}
