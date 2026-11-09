import { Button, Glass } from 'glisse';
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// Floating chat with the Yala Maha AI assistant (ai-assistant/server.js)
const _raw = (import.meta.env.VITE_AI_API_URL || 'http://localhost:5050').replace(/\/$/, '');
const AI_URL = /^https?:\/\//.test(_raw) || _raw.startsWith('/') ? _raw : `http://${_raw}`;

export default function ChatBubble() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(null);
  const [recording, setRecording] = useState(false);
  const [translating, setTranslating] = useState(null); // index being translated
  
  const listRef = useRef(null);
  const audioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [msgs, open]);

  // Clean up media recorder if unmounted
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  async function send(e) {
    if (e) e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText('');
    setMsgs((m) => [...m, { role: 'user', text: message }]);
    setBusy(true);

    const history = msgs.filter((m) => !m.error).map(({ role, text }) => ({ role, text }));
    try {
      const res = await fetch(`${AI_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.reply) {
        setMsgs((m) => [...m, { role: 'model', error: true, text: 'The assistant is busy right now. Please try again in a moment.' }]);
        return;
      }
      setMsgs((m) => [...m, { role: 'model', text: data.reply }]);
    } catch {
      setMsgs((m) => [...m, { role: 'model', error: true, text: 'Can’t reach the assistant. Check your connection and try again.' }]);
    } finally {
      setBusy(false);
    }
  }

  // --- Voice Recording & Transcribe / Voice Chat ---
  async function toggleRecord() {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  async function startRecording() {
    try {
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (audioBlob.size > 0) {
          await sendAudioMessage(audioBlob, mimeType);
        }
      };

      recorder.start();
      setRecording(true);
    } catch (err) {
      console.error('Microphone error:', err);
      alert('Microphone access is needed for voice chat. Please allow permission.');
      setRecording(false);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }

  async function sendAudioMessage(blob, mimeType) {
    setBusy(true);
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = async () => {
      const fullDataUrl = reader.result;
      const base64Audio = typeof fullDataUrl === 'string' && fullDataUrl.includes(';base64,')
        ? fullDataUrl.split(';base64,')[1]
        : fullDataUrl;
      try {
        const history = msgs.filter((m) => !m.error).map(({ role, text }) => ({ role, text }));
        const res = await fetch(`${AI_URL}/voice-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audio: base64Audio,
            mimeType: mimeType || 'audio/webm',
            history,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.reply) {
          setMsgs((m) => [...m, { role: 'model', error: true, text: 'Voice assistant is busy. Please try again.' }]);
          return;
        }

        // Add user transcription
        setMsgs((m) => [
          ...m,
          { role: 'user', text: data.heard || '🎙️ (Voice message)', isVoice: true },
          { role: 'model', text: data.reply },
        ]);

        // Auto play speech response if provided
        if (data.audioWavBase64) {
          playBase64Wav(data.audioWavBase64);
        }
      } catch (err) {
        console.error('Voice chat failed:', err);
        setMsgs((m) => [...m, { role: 'model', error: true, text: 'Could not send voice message. Check connection.' }]);
      } finally {
        setBusy(false);
      }
    };
  }

  function playBase64Wav(base64Wav) {
    try {
      const audio = new Audio(`data:audio/wav;base64,${base64Wav}`);
      audioRef.current?.pause();
      audioRef.current = audio;
      audio.play().catch(() => {});
    } catch (e) {
      console.warn('Auto playback blocked or failed', e);
    }
  }

  // --- Translation Feature (Sinhala, Tamil, English) ---
  async function translateMsg(index, targetLang) {
    const targetText = msgs[index]?.text;
    if (!targetText || busy) return;
    setTranslating(`${index}-${targetLang}`);

    try {
      const res = await fetch(`${AI_URL}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: targetText, targetLang }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.translated) {
        setMsgs((prev) => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            translation: { lang: targetLang, text: data.translated },
          };
          return updated;
        });
      }
    } catch (err) {
      console.error('Translation failed:', err);
    } finally {
      setTranslating(null);
    }
  }

  async function speak(i) {
    audioRef.current?.pause();
    if (playing === i) return setPlaying(null);
    setPlaying(i);
    try {
      const textToSpeak = msgs[i].translation?.text || msgs[i].text;
      const res = await fetch(`${AI_URL}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToSpeak }),
      });
      if (!res.ok) throw new Error();
      const audio = new Audio(URL.createObjectURL(await res.blob()));
      audioRef.current = audio;
      audio.onended = () => setPlaying(null);
      await audio.play();
    } catch {
      setPlaying(null);
    }
  }

  return (
    <>
      {open && (
        <Glass className="chat-panel" role="dialog" aria-label="AI assistant">
          <header className="chat-head">
            <div className="row gap8">
              <strong>Yala Maha Assistant</strong>
              <span className="source-chip" style={{ fontSize: 11, padding: '2px 8px' }}>Gemini Multilingual</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </header>

          <div className="chat-list" ref={listRef}>
            {msgs.length === 0 && (
              <div className="chat-hint">
                <p>🎙️ Speak or type in <b>Sinhala</b>, <b>Tamil</b>, or <b>English</b>.</p>
                <p className="f12 muted" style={{ marginTop: 4 }}>Ask about irrigation schedules, water levels, or weather alerts.</p>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                <div className="chat-msg-body grow">
                  <span>{m.text}</span>
                  {m.translation && (
                    <div className="note-box accent" style={{ margin: '4px 0 0', padding: '6px 10px', fontSize: 13 }}>
                      <b>[{m.translation.lang.toUpperCase()}]:</b> {m.translation.text}
                    </div>
                  )}
                  {/* Tool Actions: Speak + Live Translate */}
                  {!m.error && (
                    <div className="chat-msg-tools">
                      <button
                        type="button"
                        className="chat-tool-btn"
                        onClick={() => speak(i)}
                        aria-label="Listen"
                      >
                        {playing === i ? '■ Stop' : '🔊 Listen'}
                      </button>
                      <button
                        type="button"
                        className="chat-tool-btn"
                        onClick={() => translateMsg(i, 'si')}
                        disabled={translating === `${i}-si`}
                      >
                        සිං
                      </button>
                      <button
                        type="button"
                        className="chat-tool-btn"
                        onClick={() => translateMsg(i, 'ta')}
                        disabled={translating === `${i}-ta`}
                      >
                        த
                      </button>
                      <button
                        type="button"
                        className="chat-tool-btn"
                        onClick={() => translateMsg(i, 'en')}
                        disabled={translating === `${i}-en`}
                      >
                        EN
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="chat-msg model">
                <span>Thinking…</span>
              </div>
            )}
          </div>

          {/* Recording active banner */}
          {recording && (
            <div className="chat-rec-bar" style={{ margin: '0 10px 4px' }}>
              <span className="rec-dot" />
              <span>Listening... Speak in Sinhala, Tamil, or English</span>
            </div>
          )}

          <form className="chat-form" onSubmit={send}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={recording ? 'Listening...' : 'Type or speak...'}
              disabled={recording}
            />
            {/* Live Mic Button */}
            <button
              type="button"
              className={`chat-mic ${recording ? 'recording' : ''}`}
              onClick={toggleRecord}
              aria-label={recording ? 'Stop recording' : 'Start speaking'}
              title={recording ? 'Stop recording' : 'Speak in Sinhala, Tamil, or English'}
            >
              {recording ? '⏹' : '🎙️'}
            </button>
            <button type="submit" disabled={busy || (!text.trim() && !recording)}>
              Send
            </button>
          </form>
        </Glass>
      )}
      <Button
        className="chat-fab"
        icon={<Icon name={open ? 'close' : 'sms'} size={24} stroke={2} />}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
        aria-expanded={open}
      />
    </>
  );
}
