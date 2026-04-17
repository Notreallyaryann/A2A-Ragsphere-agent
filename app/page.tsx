"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type StepStatus = "idle" | "started" | "done" | "error";

interface Step {
  step: string;
  status: StepStatus;
  message: string;
  data?: Record<string, unknown>;
}

interface DocMeta {
  documentId: string;
  fileName: string;
  chunks: number;
  source: string;
}

export default function Home() {
  const [sourceUrl, setSourceUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [finalAnswer, setFinalAnswer] = useState<string | null>(null);
  const [docMeta, setDocMeta] = useState<DocMeta | null>(null);
  const [ragAnswer, setRagAnswer] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropSuccess, setDropSuccess] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  // ── Drag-and-drop handlers ────────────────────────────────────────────────────

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    // 1. Try Files first (local files)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setDroppedFile(file);
      setSourceUrl(file.name); // Show filename in the URL bar
      setDropSuccess(true);
      setTimeout(() => setDropSuccess(false), 1800);
      return;
    }

    // 2. Try URL (dragged link from browser)
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (url && url.trim()) {
      setDroppedFile(null);
      setSourceUrl(url.trim());
      setDropSuccess(true);
      setTimeout(() => setDropSuccess(false), 1800);
    }
  }, []);

  // ── Agent runner ──────────────────────────────────────────────────────────────

  async function runAgent() {
    if ((!sourceUrl.trim() && !droppedFile) || !question.trim()) return;
    setSteps([]);
    setFinalAnswer(null);
    setDocMeta(null);
    setRagAnswer(null);
    setRunning(true);

    let finalSourceUrl = sourceUrl;

    try {
      let res: Response;

      if (droppedFile) {
        // Direct A2A File Transfer: Send file as part of FormData
        const formData = new FormData();
        formData.append("file", droppedFile);
        formData.append("question", question);
        formData.append("useWebSearch", String(useWebSearch));
        if (sourceUrl && sourceUrl !== droppedFile.name) {
          formData.append("sourceUrl", sourceUrl);
        }

        res = await fetch("/api/agent", {
          method: "POST",
          body: formData,
        });
      } else {
        // Normal URL ingestion
        res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceUrl, question, useWebSearch }),
        });
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = JSON.parse(line.slice(6)) as Step & {
            data?: { documentId?: string; fileName?: string; chunks?: number; source?: string; finalAnswer?: string; ragAnswer?: string };
          };

          setSteps((prev) => {
            // Find if this step already exists
            const idx = prev.findIndex((s) => s.step === json.step);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = json;
              return updated;
            }
            return [...prev, json];
          });

          if (json.step === "ingest" && json.status === "done" && json.data) {
            setDocMeta(json.data as unknown as DocMeta);
          }
          if (json.step === "query" && json.status === "done" && json.data?.ragAnswer) {
            setRagAnswer(json.data.ragAnswer as string);
          }
          if (json.step === "cerebras" && json.status === "done" && json.data?.finalAnswer) {
            setFinalAnswer(json.data.finalAnswer as string);
          }
        }
      }
    } catch (e) {
      setSteps((prev) => [...prev, { step: "error", status: "error", message: String(e) }]);
    } finally {
      setRunning(false);
    }
  }

  const stepIcons: Record<string, string> = {
    upload: "📤",
    ingest: "📥",
    query: "🔍",
    cerebras: "🧠",
    complete: "🎉",
    error: "❌",
  };

  const stepLabels: Record<string, string> = {
    upload: "Local File Upload",
    ingest: "RagSphere Ingest",
    query: "RAG Query",
    cerebras: "Cerebras Synthesis",
    complete: "Complete",
    error: "Error",
  };

  return (
    <main className="min-h-screen bg-[#0a0a0f] text-white font-mono overflow-x-hidden">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(99,102,241,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.07) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="fixed top-[-200px] left-[-200px] w-[600px] h-[600px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)" }} />
      <div className="fixed bottom-[-200px] right-[-200px] w-[600px] h-[600px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)" }} />

      <div className="relative z-10 max-w-4xl mx-auto px-6 py-16">
        <div className="mb-14 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-xs mb-6 tracking-widest uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            A2A Agent Pipeline
          </div>
          <h1 className="text-5xl font-bold tracking-tight mb-3" style={{ fontFamily: "'Courier New', monospace", letterSpacing: "-0.02em" }}>
            <span className="text-white">Rag</span>
            <span style={{ color: "#6366f1" }}>Sphere</span>
            <span className="text-white"> × </span>
            <span style={{ color: "#10b981" }}>Cerebras</span>
          </h1>
          <p className="text-zinc-400 text-sm max-w-lg mx-auto leading-relaxed">
            An agent-to-agent pipeline. RagSphere ingests & retrieves. Cerebras{" "}
            <span className="text-emerald-400">llama3.1-8b</span> synthesizes the final answer.
          </p>

          <div className="mt-8 flex items-center justify-center gap-0 text-xs text-zinc-500 flex-wrap">
            {["You", "→", "Cerebras Agent", "→", "RagSphere A2A", "→", "Vector DB", "→", "LLM Answer"].map((node, i) => (
              <span
                key={i}
                className={node === "→" ? "mx-2 text-zinc-700" : "px-3 py-1.5 rounded border border-zinc-800 bg-zinc-900/60 text-zinc-300"}
              >
                {node}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 backdrop-blur p-8 mb-6">
          <div className="space-y-5">
            <div>
              <label className="block text-xs text-zinc-400 mb-2 tracking-widest uppercase">
                Document URL <span className="text-indigo-400">(PDF / Excel / YouTube)</span>
              </label>

              {/* Drag-and-drop zone */}
              <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className="relative rounded-xl transition-all duration-200"
                style={{
                  border: dropSuccess
                    ? "1.5px solid rgba(16,185,129,0.7)"
                    : isDragging
                    ? "1.5px dashed rgba(99,102,241,0.8)"
                    : "1.5px solid rgba(63,63,70,0.8)",
                  background: dropSuccess
                    ? "rgba(16,185,129,0.06)"
                    : isDragging
                    ? "rgba(99,102,241,0.07)"
                    : "transparent",
                  boxShadow: isDragging
                    ? "0 0 0 4px rgba(99,102,241,0.12), inset 0 0 20px rgba(99,102,241,0.04)"
                    : dropSuccess
                    ? "0 0 0 3px rgba(16,185,129,0.15)"
                    : "none",
                }}
              >
                {/* Drop overlay hint — shown while dragging */}
                {isDragging && (
                  <div className="absolute inset-0 rounded-xl flex items-center justify-center z-10 pointer-events-none">
                    <div className="flex flex-col items-center gap-1.5">
                      <span
                        className="text-2xl"
                        style={{ animation: "bounce 0.6s ease-in-out infinite alternate" }}
                      >
                        🔗
                      </span>
                      <span className="text-xs text-indigo-400 font-semibold tracking-wide">
                        Drop URL here
                      </span>
                    </div>
                  </div>
                )}

                {/* Success flash */}
                {dropSuccess && (
                  <div className="absolute inset-0 rounded-xl flex items-center justify-center z-10 pointer-events-none">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">✅</span>
                      <span className="text-xs text-emerald-400 font-semibold">URL captured!</span>
                    </div>
                  </div>
                )}

                <div
                  className="flex items-center gap-2 px-4 py-2.5 rounded-t-xl border-b"
                  style={{ borderColor: isDragging ? "rgba(99,102,241,0.2)" : "rgba(63,63,70,0.5)", background: "rgba(9,9,11,0.6)" }}
                >
                  <span className="text-xs" style={{ opacity: isDragging ? 0 : 1 }}>
                    {dropSuccess ? "✅" : droppedFile ? "📄" : "🌐"}
                  </span>
                  <span className="text-xs text-zinc-500 flex-1" style={{ opacity: isDragging ? 0 : 1 }}>
                    {droppedFile 
                      ? `${droppedFile.name} (${(droppedFile.size / 1024).toFixed(1)} KB)` 
                      : sourceUrl 
                        ? "URL loaded — edit below or drop a new source" 
                        : "Drag a file OR link from browser · or type below"}
                  </span>
                  {droppedFile ? (
                    <button 
                      onClick={() => { setDroppedFile(null); setSourceUrl(""); }}
                      className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                    >
                      Clear File
                    </button>
                  ) : (
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        background: "rgba(99,102,241,0.1)",
                        color: "rgba(165,180,252,0.7)",
                        border: "1px solid rgba(99,102,241,0.2)",
                        opacity: isDragging ? 0 : 1,
                      }}
                    >
                      file or link
                    </span>
                  )}
                </div>

                <input
                  type="text"
                  value={sourceUrl}
                  onChange={(e) => {
                    setSourceUrl(e.target.value);
                    if (droppedFile && e.target.value !== droppedFile.name) {
                      setDroppedFile(null);
                    }
                  }}
                  placeholder={droppedFile ? droppedFile.name : "https://arxiv.org/pdf/2301.00001.pdf"}
                  className={`w-full bg-zinc-950 rounded-b-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none transition-colors ${droppedFile ? 'cursor-default select-none' : ''}`}
                  readOnly={!!droppedFile}
                  style={{
                    opacity: isDragging || dropSuccess ? 0 : 1,
                    background: "rgba(9,9,11,0.9)",
                  }}
                />
              </div>

              <style>{`
                @keyframes bounce {
                  from { transform: translateY(0px); }
                  to { transform: translateY(-4px); }
                }
              `}</style>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-2 tracking-widest uppercase">Your Question</label>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What are the key findings of this paper?"
                rows={3}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
              />
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div
                  onClick={() => setUseWebSearch(!useWebSearch)}
                  className="w-10 h-5 rounded-full transition-colors relative cursor-pointer"
                  style={{ background: useWebSearch ? "#6366f1" : "#3f3f46" }}
                >
                  <div
                    className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                    style={{ transform: useWebSearch ? "translateX(20px)" : "translateX(0)" }}
                  />
                </div>
                <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">
                  Augment with web search
                </span>
              </label>

              <button
                onClick={runAgent}
                disabled={running || (!sourceUrl.trim() && !droppedFile) || !question.trim()}
                className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed text-white"
                style={{ background: running ? "#374151" : "linear-gradient(135deg, #6366f1, #10b981)" }}
              >
                {running ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Running…
                  </span>
                ) : (
                  "▶ Run Agent"
                )}
              </button>
            </div>
          </div>
        </div>

        {steps.length > 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 backdrop-blur p-6 mb-6">
            <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-5">Pipeline Execution Log</h2>
            <div className="space-y-3">
              {steps.map((s, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg p-3 border"
                  style={{
                    borderColor: s.status === "error" ? "rgba(239,68,68,0.3)" : s.status === "done" ? "rgba(16,185,129,0.2)" : "rgba(99,102,241,0.2)",
                    background: s.status === "error" ? "rgba(239,68,68,0.05)" : s.status === "done" ? "rgba(16,185,129,0.05)" : "rgba(99,102,241,0.05)",
                  }}
                >
                  <span className="text-base mt-0.5">{stepIcons[s.step] ?? "⚙️"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-bold text-zinc-300">{stepLabels[s.step] ?? s.step.toUpperCase()}</span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          background: s.status === "error" ? "rgba(239,68,68,0.2)" : s.status === "done" ? "rgba(16,185,129,0.2)" : "rgba(99,102,241,0.2)",
                          color: s.status === "error" ? "#f87171" : s.status === "done" ? "#34d399" : "#a5b4fc",
                        }}
                      >
                        {s.status === "started" ? "running…" : s.status}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400">{s.message}</p>
                  </div>
                  {s.status === "started" && (
                    <span className="w-3 h-3 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin mt-1 flex-shrink-0" />
                  )}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {docMeta && (
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-5 py-4 mb-4 text-xs text-zinc-400 flex flex-wrap gap-4">
            <span>📄 <span className="text-white">{docMeta.fileName}</span></span>
            <span>🔖 <span className="text-white">{docMeta.chunks} chunks</span></span>
            <span>🗂 <span className="text-white capitalize">{docMeta.source}</span></span>
            <span>🆔 <span className="text-zinc-500">{docMeta.documentId?.slice(0, 16)}…</span></span>
          </div>
        )}

        {ragAnswer && (
          <details className="rounded-xl border border-zinc-800 bg-zinc-950/60 mb-4 group">
            <summary className="px-5 py-3 text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors select-none">
              🔍 Raw RAG context (click to expand)
            </summary>
            <div className="px-5 pb-4 text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap border-t border-zinc-800 pt-3">
              {ragAnswer}
            </div>
          </details>
        )}

        {finalAnswer && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8">
            <div className="flex items-center gap-2 mb-5">
              <span className="text-emerald-400 text-lg">🧠</span>
              <h2 className="text-sm font-bold text-emerald-300 tracking-widest uppercase">Cerebras Final Answer</h2>
              <span className="ml-auto text-xs text-zinc-600 font-normal">llama3.1-8b</span>
            </div>
            <div className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{finalAnswer}</div>
          </div>
        )}

        <div className="mt-14 text-center text-xs text-zinc-700">
          RagSphere A2A × Cerebras llama3.1-8b · Agent-to-Agent Protocol Demo
        </div>
      </div>
    </main>
  );
}
