/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_PRINTNODE_API_KEY?: string
}

declare const __APP_BUILD__: string

interface ImportMeta {
  readonly env: ImportMetaEnv
}
