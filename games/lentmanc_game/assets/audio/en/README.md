# English voice assets

The game uses two distinct local Piper voices:

- **Narrator:** `en_US-amy-medium` — warm female English narration for introductions, transitions, and endings.
- **Aren Vale:** `en_US-lessac-medium` — clear male English delivery for selected protagonist lines.

All other characters are text-only and have no synthesized voice assignment.

Each clip has:

- an exact UTF-8 transcript in `transcripts/`;
- an unchanged WAV master in `source-wav/`;
- a browser-ready MP3 in `mp3/`, encoded with `libmp3lame -q:a 2`;
- a matching entry with duration and speaker metadata in `audio-manifest.json`.

Playback starts only after a user gesture. The game provides mute, volume, automatic-play, replay, captions, and dialogue-history controls. Missing or blocked audio leaves the full text visible.
