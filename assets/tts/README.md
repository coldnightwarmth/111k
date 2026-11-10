Text-to-speech for chat (src/tts.js, src/tts-worker.js): fetched only by players who switch it on.

- `kitten-nano-0.8.onnx`: KittenTTS nano 0.8, int8 (KittenML/kitten-tts-nano-0.8-int8 on Hugging Face),
  Apache-2.0. https://github.com/KittenML/KittenTTS
- `voices.bin`: four of its voices' style tables, float32 little-endian, 4 × 400 × 256, in this order:
  Hugo (expr-voice-4-m), Bruno (expr-voice-3-m), Kiki (expr-voice-5-f), Rosie (expr-voice-4-f).
  From the model's voices.npz.

Libraries (in vendor/):
- `onnxruntime/`: ONNX Runtime Web 1.22.0, the plain WebAssembly build (MIT, Copyright (c) Microsoft
  Corporation). https://github.com/microsoft/onnxruntime
- `phonemizer/`: phonemizer.js 1.2.1 (Apache-2.0, see its LICENSE), espeak-ng (GPL-3.0) compiled to
  WebAssembly. https://github.com/xenova/phonemizer.js
