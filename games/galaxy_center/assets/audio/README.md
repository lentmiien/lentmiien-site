# Narration assets

All narration was generated locally from the adjacent UTF-8 `.txt` transcript
files on 2026-07-29.

- Language: English
- Voice: Piper `en_US-lessac-medium` (Lessac, male)
- WAV masters: mono, 22,050 Hz, 16-bit PCM
- MP3 delivery: FFmpeg `libmp3lame`, VBR quality 2
- Runtime: local files only
- Total duration: 684.487 seconds, approximately 11 minutes 24 seconds

The `.txt` file was passed directly to the synthesis tool for each scene. It is
therefore both the narration script and the exact transcript asset.

| Scene | WAV duration | MP3 duration | Purpose |
| --- | ---: | ---: | --- |
| `01-home-orion-spur` | 57.771 s | 57.835 s | Opening and Milky Way address |
| `02-alpha-centauri` | 60.627 s | 60.682 s | Alpha Centauri and Proxima b |
| `03-quiz-light-year` | 33.831 s | 33.907 s | Discovery invitation; no answer revealed |
| `04-trappist-transits` | 61.812 s | 61.884 s | TRAPPIST-1 and transit detection |
| `05-orion-nursery` | 64.702 s | 64.758 s | Orion star and planet formation |
| `06-spiral-crossing` | 65.376 s | 65.437 s | Spiral disk, Gaia, and galactic year |
| `07-quiz-galactic-year` | 33.448 s | 33.515 s | Discovery invitation; no answer revealed |
| `08-crab-pulsar` | 64.644 s | 64.705 s | Crab pulsar and neutron stars |
| `09-central-molecular-zone` | 69.230 s | 69.303 s | Dust, gas, infrared, and radio |
| `10-sagittarius-a` | 69.939 s | 70.008 s | S2, the event horizon, and EHT |
| `11-quiz-invisible-center` | 37.442 s | 37.512 s | Discovery invitation; no answer revealed |
| `12-finale-one-galaxy` | 64.888 s | 64.940 s | Reflection and restart invitation |

`ffprobe` confirmed that every delivery file uses the MP3 codec, contains one
22.05 kHz audio channel, and has positive duration and size. FFmpeg
`volumedetect` measured consistent mean levels from approximately −16.3 dB to
−17.6 dB across the set, confirming that none of the clips is silent or
abnormally quiet.

The MP3 duration includes normal encoder padding, which accounts for the small
difference from each WAV master.
