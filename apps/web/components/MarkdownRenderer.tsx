import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

/**
 * `apps/web/components/MarkdownRenderer.tsx` — brand-styled, XSS-safe
 * markdown renderer (M04 Phase 2 S4).
 *
 * Used by the pack detail page (S4), the FP editor's preview pane
 * (S6), and the context-pack detail page (S9). Maps GitHub-flavored
 * markdown elements to brand-token classes (zero rounded corners,
 * JetBrains Mono for code, brand-blue links). Sanitises through
 * `rehype-sanitize` with GitHub's allowlist as the base, extended
 * minimally to permit our brand utility classes.
 *
 * Plugin pipeline:
 *   remark: gfm  (tables, task lists, strikethrough, autolinks)
 *   rehype: sanitize  (strip <script>, javascript: URLs, on*= handlers,
 *                      dangerous SVG attrs)
 *
 * Server Component — no client-side hydration cost. The bundle delta
 * (react-markdown + remark-gfm + rehype-sanitize ≈ 28 KB gzipped)
 * lands only on routes that use this component.
 */

// Extend the github-allowlist to permit class attribute (so our brand
// className mappings survive sanitization) on the elements we
// override below.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className'],
  },
};

const COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mt-8 mb-4 font-display text-[32px] leading-[40px] font-black uppercase tracking-wide text-(--color-text-primary)">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 mb-3 font-display text-[24px] leading-[32px] font-bold uppercase tracking-wide text-(--color-text-primary)">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 font-display text-[18px] leading-[26px] font-bold uppercase tracking-wide text-(--color-text-primary)">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-5 mb-2 font-display text-[15px] leading-[22px] font-bold uppercase tracking-wider text-(--color-text-primary)">
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-4 mb-1 font-display text-[13px] leading-[18px] font-bold uppercase tracking-wider text-(--color-text-secondary)">
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-4 mb-1 font-display text-[11px] leading-[16px] font-bold uppercase tracking-widest text-(--color-text-tertiary)">
      {children}
    </h6>
  ),
  p: ({ children }) => <p className="my-3 text-[14px] leading-[22px] text-(--color-text-primary)">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-3 ml-6 flex list-disc flex-col gap-1 text-[14px] leading-[22px] text-(--color-text-primary)">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 ml-6 flex list-decimal flex-col gap-1 text-[14px] leading-[22px] text-(--color-text-primary)">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-(--color-brand) underline decoration-(--color-brand)/40 underline-offset-2 hover:decoration-(--color-brand)"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-bold text-(--color-text-primary)">{children}</strong>,
  em: ({ children }) => <em className="italic text-(--color-text-primary)">{children}</em>,
  code: ({ children, className }) => {
    // Inline code — react-markdown v10 distinguishes inline vs block
    // by the parent: <pre><code> for blocks; bare <code> for inline.
    // We can't tell here without context, so we render inline-style
    // for any <code> not wrapped by `pre` (the `pre` handler below
    // wraps the whole thing). For block code, the `pre` handler kicks
    // in first and styles the wrapper; this `code` only adds the
    // mono font.
    if (className?.startsWith('language-') === true) {
      // Block code (fenced); className is `language-<lang>`. Let `pre`
      // own the layout; render the code child as plain mono text.
      return <code className="font-mono text-[13px] leading-[20px]">{children}</code>;
    }
    return (
      <code className="border border-(--color-border-subtle) bg-(--color-bg-elevated) px-1.5 py-0.5 font-mono text-[13px] text-(--color-text-primary)">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto border border-(--color-border-subtle) bg-(--color-bg-elevated) p-4 font-mono text-[13px] leading-[20px] text-(--color-text-primary)">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-(--color-brand) bg-(--color-bg-surface) px-4 py-2 text-(--color-text-secondary)">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border border-(--color-border-subtle)">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-(--color-bg-elevated)">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-(--color-border-subtle)">{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-display text-[11px] font-bold uppercase tracking-wider text-(--color-text-secondary)">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-3 py-2 text-[14px] text-(--color-text-primary)">{children}</td>,
  hr: () => <hr className="my-6 border-t border-(--color-border-default)" />,
  img: ({ src, alt }) => (
    // Use raw <img>: markdown images don't carry width/height metadata,
    // so next/image's required dimension props would force us to either
    // hard-code a default size or fall back to `fill` layout — both
    // worse than letting the browser size the image naturally. The lint
    // rule's "use next/image for LCP" advice doesn't apply to user-
    // authored markdown content.
    // biome-ignore lint/performance/noImgElement: see comment above
    <img src={typeof src === 'string' ? src : ''} alt={alt ?? ''} className="my-4 max-w-full" />
  ),
};

export interface MarkdownRendererProps {
  readonly body: string;
}

export function MarkdownRenderer({ body }: MarkdownRendererProps) {
  return (
    <div data-testid="markdown-renderer" className="markdown-renderer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={COMPONENTS}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
