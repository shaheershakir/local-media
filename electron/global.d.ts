export {}

declare global {
  interface Window {
    localfeed?: {
      apiBaseUrl: string
      platform: string
      selectFiles: () => Promise<string[]>
      selectFolder: () => Promise<string | undefined>
      notify: (title: string, body: string) => Promise<void>
      revealPath: (path: string) => Promise<void>
    }
  }
}
