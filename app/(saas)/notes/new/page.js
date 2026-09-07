"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { upload } from "@vercel/blob/client";
import Nav from "@/components/Nav";
import { useMe } from "@/lib/useMe";

async function api(path, method, body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const AUTOSAVE_INTERVAL_MS = 20000;
const DEEPGRAM_BASE_URL =
  "wss://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&interim_results=true&punctuate=true";

export default function NewMeetingPage() {
  const router = useRouter();
  const { user, me } = useMe();
  const [phase, setPhase] = useState("setup"); // setup | recording | finishing
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");
  const [interim, setInterim] = useState("");
  const [lines, setLines] = useState([]); // committed transcript lines, plain strings
  const [elapsed, setElapsed] = useState(0);

  const meetingIdRef = useRef(null);
  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(null);
  const timerRef = useRef(null);
  const autosaveRef = useRef(null);
  const mimeTypeRef = useRef("audio/webm");
  // Set once the user hits Stop (or navigates away) so the socket's close
  // handler knows the disconnect was intentional and shouldn't retry.
  const stoppingRef = useRef(false);

  useEffect(() => {
    if (user === null) router.push("/sign-in");
  }, [user, router]);

  useEffect(() => {
    return () => {
      // Best-effort cleanup if the user navigates away mid-recording.
      stoppingRef.current = true;
      stopStream();
      if (timerRef.current) clearInterval(timerRef.current);
      if (autosaveRef.current) clearInterval(autosaveRef.current);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function transcriptText(committedLines) {
    return committedLines.join("\n");
  }

  async function autosave() {
    if (!meetingIdRef.current) return;
    try {
      await api("/api/notes", "POST", {
        action: "autosave",
        id: meetingIdRef.current,
        transcriptText: transcriptText(linesRefGet()),
        segments: linesRefGet().map((text) => ({ text })),
      });
    } catch {
      // Silent — this is a best-effort safety net, not something to
      // interrupt an in-progress recording over.
    }
  }

  // lines state is captured via a ref too so the autosave interval (set up
  // once) always reads the latest value instead of a stale closure.
  const linesRef = useRef([]);
  function linesRefGet() {
    return linesRef.current;
  }
  function commitLine(text) {
    linesRef.current = [...linesRef.current, text];
    setLines(linesRef.current);
  }

  // Opens the live-transcription socket and resolves only once it's actually
  // OPEN (not just constructed) — critical because MediaRecorder's very
  // first chunk carries the WebM container header every later chunk depends
  // on to be decodable. Starting the recorder before the socket finishes its
  // handshake risks that first chunk arriving before the socket is open (so
  // it gets silently dropped by the readyState guard in ondataavailable),
  // which leaves Deepgram receiving headerless fragments it can't parse —
  // the connection stays open (101 OK) but transcribes nothing, which is
  // exactly the symptom this fixes.
  //
  // Also retries a couple of times on a failed handshake — a browser reports
  // any rejection as an opaque 1006/1005 close with no detail, and these can
  // be transient (a stale cached session key, a blip), so retrying with a
  // freshly minted key recovers far more often than giving up immediately.
  function openTranscriptionSocket(attempt = 1) {
    const MAX_ATTEMPTS = 3;
    return new Promise((resolve, reject) => {
      (async () => {
        const { access_token } = await api(
          // Force a fresh key on retries in case the cached one went stale.
          attempt === 1 ? "/api/notes/deepgram-token" : "/api/notes/deepgram-token?fresh=1",
          "GET"
        );
        // access_token is a short-lived real Deepgram API key (see
        // lib/deepgram.js for why), so it uses the classic "token" subprotocol.
        const ws = new WebSocket(DEEPGRAM_BASE_URL, ["token", access_token]);
        wsRef.current = ws;
        let opened = false;

        ws.onopen = () => {
          opened = true;
          setErr("");
          resolve();
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type !== "Results") return;
            const alt = msg.channel?.alternatives?.[0];
            const text = alt?.transcript || "";
            if (!text) return;
            if (msg.is_final) {
              commitLine(text);
              setInterim("");
            } else {
              setInterim(text);
            }
          } catch {
            // Ignore malformed/unexpected messages rather than breaking the recording.
          }
        };

        ws.onerror = () => {
          // The browser's WebSocket error event carries no detail by spec —
          // the close event that follows is where the real code/reason shows up.
          console.error("Deepgram WebSocket error event (see close event for detail)");
        };

        ws.onclose = (event) => {
          console.error("Deepgram WebSocket closed:", event.code, event.reason);
          // A clean 1000 during teardown (stop, or navigating away) is expected.
          if (event.code === 1000 || stoppingRef.current) return;

          if (attempt < MAX_ATTEMPTS) {
            console.warn(`Deepgram handshake failed — retrying (${attempt + 1}/${MAX_ATTEMPTS})`);
            setTimeout(() => {
              openTranscriptionSocket(attempt + 1).then(resolve, reject);
            }, 1000 * attempt);
            return;
          }
          const err = new Error(
            `Live transcription connection closed (code ${event.code}${event.reason ? ": " + event.reason : ""})`
          );
          if (!opened) reject(err);
          else setErr(err.message + " — recording continues, but the transcript may be incomplete.");
        };
      })().catch(reject);
    });
  }

  async function start() {
    setErr("");
    stoppingRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const { id } = await api("/api/notes", "POST", { action: "start", title: title.trim() });
      meetingIdRef.current = id;

      await openTranscriptionSocket();

      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      const mimeType = mimeCandidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
      mimeTypeRef.current = mimeType || "audio/webm";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = async (event) => {
        if (!event.data || event.data.size === 0) return;
        chunksRef.current.push(event.data);
        // readyState is checked again after the await, not just before it —
        // the socket can close during the (async) arrayBuffer conversion,
        // and calling send() on a closed socket throws.
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const buf = await event.data.arrayBuffer();
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        try {
          wsRef.current.send(buf);
        } catch (e) {
          console.warn("Dropped an audio chunk — socket closed mid-send:", e.message);
        }
      };

      recorder.start(250);
      startedAtRef.current = Date.now();
      setPhase("recording");
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
      autosaveRef.current = setInterval(autosave, AUTOSAVE_INTERVAL_MS);
    } catch (e) {
      setErr(
        e?.name === "NotAllowedError"
          ? "Microphone access was denied. Allow microphone access and try again."
          : e.message || "Couldn't start recording."
      );
      stopStream();
    }
  }

  async function stop() {
    setPhase("finishing");
    stoppingRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (autosaveRef.current) clearInterval(autosaveRef.current);

    const durationSec = startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0;

    await new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") return resolve();
      recorder.onstop = resolve;
      recorder.stop();
    });
    stopStream();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close();

    const finalText = transcriptText(linesRef.current);
    let audioBlobPath = null;
    let audioContentType = null;
    let audioSizeBytes = null;

    try {
      if (chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        const ext = mimeTypeRef.current.includes("ogg") ? "ogg" : "webm";
        const token = await auth.currentUser.getIdToken();
        // Path must start with notes/{accountId}/ — enforced server-side in
        // /api/notes/blob-upload's onBeforeGenerateToken.
        const result = await upload(`notes/${me.accountId}/${meetingIdRef.current}.${ext}`, blob, {
          access: "private",
          contentType: mimeTypeRef.current,
          handleUploadUrl: "/api/notes/blob-upload",
          headers: { Authorization: "Bearer " + token },
        });
        audioBlobPath = result.pathname;
        audioContentType = mimeTypeRef.current;
        audioSizeBytes = blob.size;
      }
    } catch (e) {
      // Recording still gets saved as a transcript-only meeting if the
      // audio upload fails — don't lose the transcript over it.
      console.error("Notes: audio upload failed", e);
    }

    try {
      await api("/api/notes", "POST", {
        action: "finalize",
        id: meetingIdRef.current,
        transcriptText: finalText,
        segments: linesRef.current.map((text) => ({ text })),
        durationSec,
        audioBlobPath,
        audioContentType,
        audioSizeBytes,
      });
    } catch (e) {
      setErr(e.message || "Couldn't save this meeting.");
      setPhase("recording");
      return;
    }

    router.push(`/notes/${meetingIdRef.current}`);
  }

  function fmtElapsed(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  return (
    <div>
      <Nav />
      <div className="admin-shell" style={{ maxWidth: 720 }}>
        <h1 className="dash-heading" style={{ fontSize: 20, marginBottom: 4 }}>New meeting</h1>
        <p className="dash-sub" style={{ marginBottom: 18 }}>
          Record a meeting and get a live transcript, then an AI summary once you stop.
        </p>

        {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}

        {phase === "setup" && (
          <div className="card">
            <label className="label">Meeting title (optional)</label>
            <input
              className="input"
              placeholder="e.g. Vendor call with Sharma Traders"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ marginBottom: 16 }}
            />
            <button className="btn-primary" onClick={start}>Start recording</button>
          </div>
        )}

        {(phase === "recording" || phase === "finishing") && (
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
                <strong>{fmtElapsed(elapsed)}</strong>
              </div>
              <button className="btn-primary" onClick={stop} disabled={phase === "finishing"}>
                {phase === "finishing" ? "Saving…" : "Stop"}
              </button>
            </div>
            <div
              style={{
                minHeight: 220,
                maxHeight: 400,
                overflowY: "auto",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: 14,
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              {lines.length === 0 && !interim && <p className="muted">Listening…</p>}
              {lines.map((l, i) => (
                <p key={i} style={{ margin: "0 0 8px" }}>{l}</p>
              ))}
              {interim && <p style={{ margin: 0, color: "var(--muted, #94a3b8)" }}>{interim}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
