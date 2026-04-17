import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RagSphere × Cerebras Agent",
  description: "Agent-to-Agent RAG pipeline powered by RagSphere A2A and Cerebras llama3.1-8b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
