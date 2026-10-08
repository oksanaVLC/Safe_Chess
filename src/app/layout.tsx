import type { Metadata, Viewport } from "next";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import "./globals.css";
import { HtmlLang } from "@/i18n/HtmlLang";

export const metadata: Metadata = {
  description: "Chess for kids — and grown-ups too",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FAFAFA",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <HtmlLang />
        {children}
      </body>
    </html>
  );
}
