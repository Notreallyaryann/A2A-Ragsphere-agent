import { NextRequest, NextResponse } from "next/server";
import Cerebras from "@cerebras/cerebras_cloud_sdk";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const cerebras = new Cerebras({
  apiKey: process.env.CEREBRAS_API_KEY!,
});

const RAGSPHERE_BASE = "https://ragsphere.vercel.app/api/a2a/tasks";
const RAGSPHERE_KEY = process.env.RAGSPHERE_API_KEY!;
// Use the Render URL if available, fallback to localhost for local testing
const APP_URL = process.env.PUBLIC_APP_URL || "https://a2a-ragsphere-agent.onrender.com";


// ── RagSphere helpers ──────────────────────────────────────────────────────────

async function ingestDocument(sourceUrl: string) {
  // Pure JSON ingestion (Matches .well-known "text/plain" / JSON)
  const res = await fetch(RAGSPHERE_BASE, {
    method: "POST",
    headers: {
      "x-a2a-key": RAGSPHERE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ 
      skill: "ingest", 
      input: { source_url: sourceUrl } 
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Ingest failed (${res.status})`);
  return data.output as { documentId: string; fileName: string; chunks: number; source: string };
}

async function queryDocument(documentId: string, question: string, useWebSearch = false) {
  const res = await fetch(RAGSPHERE_BASE, {
    method: "POST",
    headers: {
      "x-a2a-key": RAGSPHERE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      skill: "query",
      input: { question, document_id: documentId, use_web_search: useWebSearch },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Query failed");
  return data.output.answer as string;
}

// ── Cerebras "brain" – decides what to do ─────────────────────────────────────

async function runCerebrasBrain(
  userQuestion: string,
  ragAnswer: string,
  docMeta: { fileName: string; chunks: number; source: string }
) {
  const systemPrompt = `You are an intelligent research assistant. You have retrieved context from a document using a RAG (Retrieval-Augmented Generation) system. Your job is to synthesize the retrieved context into a clear, concise, and insightful final answer for the user.

Document metadata:
- File: ${docMeta.fileName}
- Source type: ${docMeta.source}
- Total chunks indexed: ${docMeta.chunks}

Instructions:
- Provide a well-structured, readable answer
- If the retrieved context answers the question, summarize and elaborate on it
- Highlight key insights, data points, or conclusions
- Keep your tone professional but approachable
- If something is unclear from the context, say so honestly`;

  const completion = await cerebras.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `User Question: "${userQuestion}"\n\nRAG Retrieved Context:\n${ragAnswer}\n\nPlease synthesize a final answer:`,
      },
    ],
    model: "llama3.1-8b",
    max_completion_tokens: 1024,
    temperature: 0.2,
    top_p: 1,
    stream: false,
  });

  const choices = (completion as { choices: Array<{ message: { content: string } }> }).choices;
  return choices[0].message.content ?? "";
}

// ── Stream helper ──────────────────────────────────────────────────────────────

function createSSE(controller: ReadableStreamDefaultController, data: object) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}


export async function POST(req: NextRequest) {
  let sourceUrl: string | undefined;
  let question: string;
  let useWebSearch = false;
  let file: File | undefined;

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    sourceUrl = (formData.get("sourceUrl") as string) || undefined;
    question = formData.get("question") as string;
    useWebSearch = formData.get("useWebSearch") === "true";
    file = (formData.get("file") as File) || undefined;
  } else {
    const body = await req.json();
    sourceUrl = body.sourceUrl;
    question = body.question;
    useWebSearch = body.useWebSearch;
  }

  if ((!sourceUrl && !file) || !question) {
    return NextResponse.json({ error: "Source (URL or File) and question are required" }, { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 0: Self-Host File if binary (Bridge Pattern - Pure A2A)
        let finalSourceUrl = sourceUrl;
        if (file) {
          createSSE(controller, { step: "host", status: "started", message: "💿 Hosting local file for A2A transfer..." });
          try {
            const fileName = `${crypto.randomUUID()}-${file.name.replace(/\s+/g, "_")}`;
            const filePath = path.join("/tmp", fileName);
            const buffer = Buffer.from(await file.arrayBuffer());
            fs.writeFileSync(filePath, buffer);
            
            finalSourceUrl = `${APP_URL}/api/files/${fileName}`;
            createSSE(controller, { step: "host", status: "done", message: "✅ File hosted successfully" });
          } catch (e: any) {
            createSSE(controller, { step: "host", status: "error", message: `❌ Hosting failed: ${e.message}` });
            controller.close();
            return;
          }
        }

        // Step 1: Ingest
        createSSE(controller, { step: "ingest", status: "started", message: "📥 Ingesting document via RagSphere A2A..." });

        let docMeta: { documentId: string; fileName: string; chunks: number; source: string };
        try {
          docMeta = await ingestDocument(finalSourceUrl!);
          createSSE(controller, {
            step: "ingest",
            status: "done",
            message: `✅ Ingested "${docMeta.fileName}" (${docMeta.chunks} chunks, type: ${docMeta.source})`,
            data: docMeta,
          });
        } catch (e: unknown) {
          createSSE(controller, { step: "ingest", status: "error", message: `❌ Ingest failed: ${(e as Error).message}` });
          controller.close();
          return;
        }

        // Step 2: RAG Query
        createSSE(controller, { step: "query", status: "started", message: "🔍 Querying document via RagSphere RAG..." });

        let ragAnswer: string;
        try {
          ragAnswer = await queryDocument(docMeta.documentId, question, useWebSearch);
          createSSE(controller, { step: "query", status: "done", message: "✅ Retrieved relevant context from document", data: { ragAnswer } });
        } catch (e: unknown) {
          createSSE(controller, { step: "query", status: "error", message: `❌ Query failed: ${(e as Error).message}` });
          controller.close();
          return;
        }

        // Step 3: Cerebras synthesis
        createSSE(controller, { step: "cerebras", status: "started", message: "🧠 Cerebras (llama3.1-8b) synthesizing final answer..." });

        let finalAnswer: string;
        try {
          finalAnswer = await runCerebrasBrain(question, ragAnswer, docMeta);
          createSSE(controller, { step: "cerebras", status: "done", message: "✅ Answer synthesized", data: { finalAnswer } });
        } catch (e: unknown) {
          createSSE(controller, { step: "cerebras", status: "error", message: `❌ Cerebras failed: ${(e as Error).message}` });
          controller.close();
          return;
        }

        createSSE(controller, { step: "complete", status: "done", message: "🎉 Pipeline complete" });
        controller.close();
      } catch (e: unknown) {
        createSSE(controller, { step: "error", status: "error", message: (e as Error).message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
