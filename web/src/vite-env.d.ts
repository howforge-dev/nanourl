/* eslint-disable @typescript-eslint/triple-slash-reference -- ambient shims need these */
/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component<Record<string, never>>;
  export default component;
}
