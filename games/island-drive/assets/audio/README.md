# Local welcome narration

`welcome.wav` is actual generated speech, synthesized on 2026-09-25 using the configured local Piper service and the `en_US-lessac-medium` voice. No runtime synthesis or network service is used by the game.

- Duration: 11.877 seconds.
- Format: mono PCM WAV, 22,050 Hz, 16 bit; 523,820 bytes.
- Exact transcript: `welcome.txt`, also displayed next to the listen control.
- Playback: explicit user gesture only; stop control, visible transcript, and graceful playback-failure message.
- Engine sound: optional quiet Web Audio oscillator, off by default; silenced while paused, in menus, or after entering water.
- No voice models or speech engine binaries are redistributed.

Generation command (author's configured local skill, optional developer tooling):

```bash
python3 /home/lennart/.codex/skills/generate-local-tts/scripts/generate_tts.py \
  --voice en_US-lessac-medium \
  --text-file /absolute/path/to/games/island-drive/assets/audio/welcome.txt \
  --output /absolute/path/to/a/new-welcome.wav
```

The committed WAV is sufficient for deployment. The synthesis tool is not a game dependency.
