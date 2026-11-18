# KGAudioLab

The KGAudioLab homepage and static browser apps:

- `/kgstudio/` — K.G.Studio
- `/instvela/` — InstVELA M01Preview

The homepage is plain HTML, CSS, and JavaScript. Its source lives in `index.html`
and `homepage/`. The KGStudio animation is the GIF from the project's README.
The embedded violin playground reuses InstVELA's original MIDI frontend, piano
roll, inference worker, and render defaults. It loads the models when the visitor
first chooses **Render violin**; no MIDI upload or settings controls are exposed.

Both InstVELA demos download models from the public
[Hugging Face repository](https://huggingface.co/KGAudioLab/InstVELA-models-onnx)
without a token. Inference runs in the browser. To update the model revision,
edit `homepage/instvela-models.js` and rebuild with `node scripts/build-instvela.mjs`.
