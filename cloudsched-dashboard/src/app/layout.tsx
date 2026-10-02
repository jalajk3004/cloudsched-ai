import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CloudSched-AI Dashboard",
  description: "Real-time scheduler benchmarking dashboard",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full dark">
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}