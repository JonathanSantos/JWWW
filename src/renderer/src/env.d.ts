/// <reference types="vite/client" />
import type { JwwwApi } from '@shared/types'

declare global {
  interface Window {
    api: JwwwApi
  }
}

export {}
