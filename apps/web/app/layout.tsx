import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Agent Creations — A little help, made by you",
  description:
    "Build a portable AI agent. Bring it to the tools you already use.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
