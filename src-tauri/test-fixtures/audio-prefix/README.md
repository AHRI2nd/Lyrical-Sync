# BPM prefix decoder fixtures

These synthetic two-second audio samples exercise the formats accepted by the audio picker. `prefix.wav` is generated with Python's standard library at 48 kHz; it contains alternating 100 ms anti-phase stereo tone and silence pulses. FFmpeg encodes that sample as AIFF, FLAC, MP3, AAC/M4A, ALAC/M4A, ADTS AAC, Ogg Vorbis and Ogg Opus. The 6-channel and 8-channel Opus samples use synthetic tones. No recorded or copyrighted audio is included.

The Rust tests copy each fixture to a temporary path with the corresponding extension, run the native prefix decoder, and assert bounded finite energy output. A separate 121-second generated WAV exercises the 120-second cutoff.
