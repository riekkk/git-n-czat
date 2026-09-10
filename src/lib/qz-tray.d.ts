// qz-tray ships no TypeScript types of its own. This is a minimal shim
// covering only the surface printer.ts actually uses — not a full API type.
declare module 'qz-tray' {
  const qz: {
    websocket: {
      connect: (options?: unknown) => Promise<void>
      disconnect: () => Promise<void>
      isActive: () => boolean
    }
    configs: {
      create: (printer: unknown, options?: unknown) => unknown
    }
    print: (config: unknown, data: unknown[]) => Promise<void>
  }
  export default qz
}
