import { generate } from './codeArt.js';

globalThis.onmessage = ({ data }) => {
  try {
    const paths = generate({ code: data.code, assets: data.assets ?? {} });
    globalThis.postMessage({ type: 'result', paths });
  } catch (error) {
    globalThis.postMessage({
      type: 'error',
      message: error?.message ?? String(error),
      name: error?.name ?? 'Error',
    });
  }
};
