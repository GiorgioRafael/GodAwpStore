import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { STORE_LOGO_URL, STORE_NAME, STORE_SLUG } from "@/lib/brand";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: `${STORE_NAME} Admin`,
    template: `%s · ${STORE_NAME}`,
  },
  description: `Painel administrativo seguro da ${STORE_NAME}.`,
  applicationName: `${STORE_NAME} Admin`,
  icons: STORE_LOGO_URL
    ? {
        icon: STORE_LOGO_URL,
        shortcut: STORE_LOGO_URL,
        apple: STORE_LOGO_URL,
      }
    : undefined,
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // data-store fica no elemento raiz: é o seletor que troca a paleta da
  // roleta, que não passa pelo tema dourado do painel.
  return (
    <html
      lang="pt-BR"
      data-store={STORE_SLUG}
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-background antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
