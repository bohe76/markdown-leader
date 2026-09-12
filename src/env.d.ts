/// <reference types="vite/client" />

declare const __APP_VERSION__: string

declare module 'markdown-it-deflist' {
  import type MarkdownIt from 'markdown-it'
  const plugin: (md: InstanceType<typeof MarkdownIt>) => void
  export default plugin
}

declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it'
  interface TaskListOptions { enabled?: boolean; label?: boolean; labelAfter?: boolean }
  const plugin: (md: InstanceType<typeof MarkdownIt>, options?: TaskListOptions) => void
  export default plugin
}
