import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { Breadcrumb } from '@/components/Breadcrumb';
import { HeaderNav } from '@/components/HeaderNav';
import { getActor } from '@/lib/auth';
import { clerkAppearance } from '@/lib/clerk-appearance';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  weight: ['300', '400', '500', '700', '900'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  weight: ['400', '500', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ContextOS',
  description: 'Admin + audit-trail UI for ContextOS — Module 04 Web App.',
};

/**
 * Root layout. Wraps the entire tree in <ClerkProvider> so Clerk
 * components anywhere in the route tree (sign-in/sign-up,
 * OrganizationProfile, UserButton, etc.) get the auth context. Solo
 * mode benefits from the provider being a no-op when no real session
 * exists; the middleware short-circuit handles the auth-bypass story.
 *
 * `signInUrl` + `signUpUrl` point at our brand-styled wrappers so
 * Clerk's redirect logic (e.g. when middleware.protect() throws)
 * lands on the right page.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  return (
    <ClerkProvider
      appearance={clerkAppearance}
      signInUrl="/auth/sign-in"
      signUpUrl="/auth/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <body>
          <HeaderNav actor={actor} />
          <Breadcrumb />
          {/* M04 Phase 2 S2c: padding moves into per-section layouts.
              The /projects/[slug] nested layout adds its own container
              (project bar + sub-nav + content). Top-level pages (`/`,
              /init, /sync, /settings/*) wrap themselves in their own
              max-w container as needed. This keeps the project layout
              from being padded twice. */}
          <main>{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
