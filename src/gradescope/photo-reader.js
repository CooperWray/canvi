function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isRemote(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

export async function resolveOcrOptions() {
  let createRequire;
  let path;
  try {
    ({ createRequire } = await import("node:module"));
    path = await import("node:path");
  } catch {
    throw fail("reader_missing");
  }
  try {
    const require = createRequire(import.meta.url);
    const dataDir = path.dirname(require.resolve("@tesseract.js-data/eng/package.json"));
    const langPath = path.join(dataDir, "4.0.0_best_int");
    const workerPath = require.resolve("tesseract.js/src/worker-script/node/index.js");
    if (isRemote(langPath) || isRemote(workerPath)) throw fail("reader_missing");
    return {
      langPath,
      workerPath,
      cacheMethod: "none",
      gzip: true,
    };
  } catch (error) {
    if (error?.code === "reader_missing") throw error;
    throw fail("reader_missing");
  }
}

export async function readPhoto(photo) {
  if (typeof photo?.text === "string") return photo.text;
  const bytes = photo?.bytes;
  if (!bytes) throw fail("unreadable_photo");
  const options = await resolveOcrOptions();
  let createWorker;
  try {
    ({ createWorker } = await import("tesseract.js"));
  } catch {
    throw fail("reader_missing");
  }
  const worker = await createWorker("eng", 1, options);
  try {
    const result = await worker.recognize(new Blob([bytes], { type: "image/jpeg" }));
    return result?.data?.text ?? "";
  } finally {
    await worker.terminate();
  }
}
