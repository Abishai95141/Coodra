/**
 * `apps/web-v2/lib/clerk-appearance.ts` — visual theming for Clerk's
 * embedded widgets so sign-in / sign-up / user-profile / org-switcher
 * blend with the editorial dark surface instead of clashing with it.
 *
 * Mirrors the design tokens in `app/globals.css`:
 *   --bg          #0a0e0a   (page background)
 *   --bg-2        #0d130d   (card background)
 *   --ink         #e8e6e1   (primary text)
 *   --ink-dim     #8a8d86   (secondary text)
 *   --rule        rgba(232,230,225,0.08) (rule lines)
 *   --rule-strong rgba(232,230,225,0.16) (form borders)
 *   --accent      #7dd87d   (interactive accents)
 *   --warn        #d97a7a   (errors)
 *
 * Clerk's `appearance` prop accepts CSS-variable-style `variables` plus
 * per-element class overrides. We use both to keep typography
 * consistent (Inter Tight for sans, JetBrains Mono for code/eyebrows).
 *
 * Why we don't use Clerk's pre-baked "dark" theme: it skews blue-purple
 * and loses our subtle green-accent identity. The hand-tuned values
 * below match the editorial dark palette exactly.
 */

export const clerkAppearance = {
  variables: {
    colorPrimary: '#7dd87d',
    colorBackground: '#0d130d',
    colorInputBackground: '#0a0e0a',
    colorText: '#e8e6e1',
    colorTextSecondary: '#8a8d86',
    colorTextOnPrimaryBackground: '#0a0e0a',
    colorInputText: '#e8e6e1',
    colorDanger: '#d97a7a',
    colorSuccess: '#7dd87d',
    colorWarning: '#c08a3e',
    colorNeutral: '#8a8d86',
    fontFamily: 'Inter Tight, system-ui, sans-serif',
    fontFamilyButtons: 'JetBrains Mono, monospace',
    fontSize: '14px',
    borderRadius: '0px',
    spacingUnit: '8px',
  },
  elements: {
    rootBox: 'font-sans',
    card: 'bg-bg-2 border border-rule-strong rounded-none',
    headerTitle: 'font-serif tracking-tight',
    headerSubtitle: 'text-ink-dim',
    socialButtonsBlockButton: 'rounded-none border-rule-strong text-ink',
    socialButtonsBlockButtonText: 'font-mono uppercase tracking-widest text-xs',
    formButtonPrimary:
      'rounded-none border border-accent bg-accent text-bg uppercase tracking-widest text-xs font-mono font-medium',
    formButtonReset: 'rounded-none border border-rule-strong text-ink-dim uppercase tracking-widest text-xs font-mono',
    formFieldLabel: 'font-mono uppercase tracking-widest text-[10px] text-ink-mute',
    formFieldInput: 'rounded-none bg-bg border-rule-strong text-ink font-mono text-sm',
    identityPreviewText: 'font-mono text-ink-dim',
    identityPreviewEditButtonIcon: 'text-accent',
    formFieldAction: 'text-accent text-xs font-mono uppercase tracking-wider',
    footerActionText: 'text-ink-dim',
    footerActionLink: 'text-accent underline-offset-2',
    dividerLine: 'bg-rule',
    dividerText: 'text-ink-mute font-mono text-xs uppercase tracking-widest',
    alertText: 'text-warn',
  },
  layout: {
    socialButtonsPlacement: 'bottom' as const,
    socialButtonsVariant: 'blockButton' as const,
  },
} as const;
