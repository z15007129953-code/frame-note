import type { Metadata } from "next";
import "@fontsource/manrope/600.css";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/600.css";
import "./globals.css";
import { LanguageProvider } from "./i18n";
export const metadata: Metadata = {
  title: "Frame Note — A place for the work",
  description: "A private design review workspace.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
