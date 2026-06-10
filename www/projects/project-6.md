# justwispr

Voice dictation at your cursor. Press a hotkey, speak, press again — your words appear as
text in whatever app has focus. Fully local: faster-whisper on your own hardware, no cloud
services, no API keys, no network.

**Source**: private repo — happy to walk through it.

---

## What it is

A Windows tray application for system-wide voice dictation:

- **Global hotkey** (default `Ctrl+Alt+Space`) toggles recording from anywhere.
- **Local speech-to-text** via [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
  — offline, private, and fast enough to feel instant on a GPU.
- **Clipboard injection**: transcribed text is pasted at the cursor, with the previous
  clipboard contents saved and restored so dictation never clobbers what you were copying.
- **Tray state machine**: the icon color tells you exactly what's happening — idle,
  recording, transcribing, paused.
- **Post-processing pipeline**: configurable text replacements, formatting, segment
  handling, and a transcription history; speaker diarization for transcribing audio files.

A PowerShell installer sets up an isolated venv, installs dependencies, and generates
launchers (including a hidden-console one for everyday use).

---

## Why I built it

Commercial dictation tools ship your voice to someone's cloud and charge a subscription
for it. Whisper made local transcription genuinely good; the missing piece was the *last
inch* — getting audio from a hotkey press into a model and the text back under your cursor
without friction. That last inch turns out to be where all the engineering lives:
clipboard etiquette, focus handling, audio device management, and a state machine that
never leaves the mic silently hot.

I dictate into editors, chat windows, and code review boxes with it daily, which is the
best QA regime a tool can have.

---

## Technical decisions worth noting

**Clipboard paste over keystroke synthesis**: injecting via clipboard + paste is far more
reliable across applications than simulating keystrokes, and saving/restoring the
clipboard makes it polite.

**Local-only as a hard constraint, not a mode**: there is no cloud fallback to leak into.
Model size and compute type are the tuning knobs instead.

**Tray-first UX**: no window to manage. The entire interface is a hotkey and an icon color
— dictation should be ambient, not an app you switch to.

---

## Stack

Python, faster-whisper, Win32 APIs (clipboard, system sounds, tray), sounddevice audio
capture, pystray-style tray UI, PowerShell installer
