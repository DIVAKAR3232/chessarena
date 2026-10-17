/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public URL of the API host for Socket.IO in production (e.g. https://api.example.com). */
  readonly VITE_SOCKET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
