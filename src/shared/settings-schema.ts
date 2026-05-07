export interface SettingsFile {
  version: 1;
  primaryOutputDeviceId: string | null;
  monitorOutputDeviceId: string | null;
}

export function defaultSettings(): SettingsFile {
  return {
    version: 1,
    primaryOutputDeviceId: null,
    monitorOutputDeviceId: null
  };
}
