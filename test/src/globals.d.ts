/** Injected by vite.config.ts: this machine's LAN IPv4, used for the phone QR code. */
declare const __LAN_IP__: string;

/** joy-con-webhid ships without types; this is the subset we use. */
declare module 'joy-con-webhid' {
  export interface JoyConInputDetail {
    actualAccelerometer?: { x: number; y: number; z: number };              // in G
    actualGyroscope?: { rps: { x: number; y: number; z: number } };         // rad/s
    buttonStatus?: Record<string, boolean>;
  }
  export interface JoyCon extends EventTarget {
    device: { productName: string; opened: boolean };
    eventListenerAttached?: boolean;
    open(): Promise<void>;
    enableStandardFullMode(): Promise<void>;
    enableIMUMode(): Promise<void>;
    enableVibration(): Promise<void>;
    rumble(lowFrequency: number, highFrequency: number, amplitude: number): Promise<void>;
  }
  export function connectJoyCon(): Promise<void>;
  export const connectedJoyCons: Map<number, JoyCon>;
}
