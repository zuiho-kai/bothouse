# Bothouse resident face

The six built-in residents use the face mesh of **HairSample_Female** by **pixiv / VRoid Project**, published under **CC0**. The original VRM metadata identifies this specific sample as CC0. See [pixiv's sample-by-sample license list](https://vroid.pixiv.help/hc/en-us/articles/4402614652569) and the [archived sample download](https://opengameart.org/content/vroid-studio-cc0-models).

Only Face.baked geometry and its painted mouth, eye whites, liner, lashes, eyebrows, irises, highlights and skin are used. The runtime keeps the original triangle groups, UVs and normals, adapts the face to each costume, and uses original blink, A, joy, sorrow and angry morph deltas. The iris texture is graded to accept a character tint. Face and neck share one skin material. Hairstyles, ornaments, clothes and body animation come from the resident model.

Reproduce with Python 3 and FFmpeg from the project directory:

```sh
python tools/export-resident-face.py path/to/HairSample_Female.vrm
```

The converter checks source SHA-256 `d9ef39f04e54b3684d31a8db47efe4c2537b80f1bc15dedce3ae3d1d2acebda2`. The JSON contains local indexed geometry and five sparse expression targets. Eight downsized PNGs are bundled with the game. The source VRM and modeling tools are unnecessary at runtime.
