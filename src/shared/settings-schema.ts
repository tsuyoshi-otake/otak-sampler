export type RecordingSource = 'loopback' | 'mic';

export interface SettingsFile {
  version: 1;
  primaryOutputDeviceId: string | null;
  monitorOutputDeviceId: string | null;
  recordingSource: RecordingSource;
}

export function defaultSettings(): SettingsFile {
  return {
    version: 1,
    primaryOutputDeviceId: null,
    monitorOutputDeviceId: null,
    recordingSource: 'loopback'
  };
}
