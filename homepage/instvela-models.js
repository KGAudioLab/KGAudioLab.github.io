// Pin the revision so the manifest, weights, and self-test data always agree.
const modelRepository = "https://huggingface.co/KGAudioLab/InstVELA-models-onnx";
const modelRevision = "69f562c0e1d47411d71cd256adab67e1f4162303";

export function getInstvelaModelUrl(model) {
  return `${modelRepository}/resolve/${modelRevision}/models/${encodeURIComponent(model)}`;
}
