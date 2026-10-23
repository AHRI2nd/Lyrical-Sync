# Native Windows ARM64 AI wheels

These CPython 3.12 CPU wheels are embedded only in Windows ARM64 builds.
The x64 Windows and macOS Python/package graphs and storage paths are unchanged.
`provenance.json` pins every payload digest and the exact upstream source.
Each wheel includes its upstream license; readable copies are in `licenses/`.
The soxr source archive includes its bundled libsoxr/PFFFT source and licenses.

Verify the checked-in payloads:

```sh
python scripts/verify_windows_arm64_ai.py
python scripts/test_arm_ai_artifacts.py
```

To rebuild, use native Windows ARM64 CPython 3.12 with an ARM64 MSVC developer
command prompt (Visual Studio ARM64 C++ tools and Windows SDK). Install the build
inputs in a separate environment: torch 2.14.1+cpu from the official PyTorch CPU
index, numpy 2.5.4, setuptools 84.2.1, wheel 0.48.0, ninja 1.13.2, cmake 4.4.4,
nanobind 3.1.0, scikit-build-core 1.1.1 and setuptools-scm 10.3.4.

```powershell
python scripts/build_windows_arm64_ai.py --work-dir C:\ls-arm-ai --output C:\ls-arm-ai\wheels
python scripts/verify_windows_arm64_ai.py --root C:\ls-arm-ai\wheels
```

The build uses hash-verified sources, disables CUDA/ROCm, retains compiler ABI
checks, and applies the app's existing reviewed Windows CTC patches. TorchAudio's
build output decoder is set to UTF-8 to match the selected console code page.
Short, space-free source paths avoid upstream archive/CMake path limitations.
New wheels and provenance are written outside the vendored directory for review.
Build timestamps and temporary object paths can change binary/wheel digests;
rebuilding does not silently approve or replace the committed payloads.
