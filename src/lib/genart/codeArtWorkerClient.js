export function createCodeArtWorkerClient({ timeoutMs = 30_000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('Worker timeout must be positive and finite');
  let activeJob;

  function cancel() {
    if (!activeJob) return;
    const error = new Error('Code Art generation cancelled.');
    error.name = 'AbortError';
    activeJob.reject(error);
  }

  function generate({ code, assets = {} }) {
    cancel();
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./codeArt.worker.js', import.meta.url), { type: 'module' });
      let timer;
      const job = {
        reject: error => finish(reject, error),
      };
      function finish(settle, value) {
        if (activeJob !== job) return;
        activeJob = undefined;
        clearTimeout(timer);
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
        settle(value);
      }
      activeJob = job;
      worker.onmessage = ({ data }) => {
        if (data?.type === 'result' && Array.isArray(data.paths)) {
          finish(resolve, data.paths);
        } else if (data?.type === 'error') {
          const error = new Error(data.message || 'Code Art generation failed.');
          error.name = data.name || 'Error';
          finish(reject, error);
        } else {
          finish(reject, new Error('Code Art worker returned an invalid response.'));
        }
      };
      worker.onerror = event => {
        event.preventDefault();
        finish(reject, new Error(event.message || 'Code Art worker failed to start or crashed.'));
      };
      worker.onmessageerror = () => {
        finish(reject, new Error('Could not read the Code Art worker response.'));
      };
      timer = setTimeout(() => {
        finish(reject, new Error(`Code Art generation timed out after ${timeoutMs / 1000} seconds.`));
      }, timeoutMs);
      try {
        worker.postMessage({ code, assets });
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  return { generate, cancel };
}
