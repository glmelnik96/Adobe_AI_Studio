// Single point of CSInterface.evalScript. Returns Promise<object>.
// CSInterface is loaded globally via <script> tag in index.html.

let cs = null;
function getCS() {
  if (cs) return cs;
  if (typeof window !== 'undefined' && window.CSInterface) {
    cs = new window.CSInterface();
  }
  return cs;
}

function call(fnName, ...args) {
  return new Promise((resolve, reject) => {
    const csi = getCS();
    if (!csi) return reject(new Error('CSInterface unavailable'));
    const argsJs = args.map(a => JSON.stringify(a)).join(', ');
    csi.evalScript(`${fnName}(${argsJs})`, (out) => {
      try {
        const parsed = JSON.parse(out);
        if (parsed && parsed.ok) resolve(parsed);
        else reject(Object.assign(new Error(parsed && parsed.error || 'unknown'), { result: parsed }));
      } catch (e) {
        reject(new Error('host parse fail: ' + out));
      }
    });
  });
}

export const host = {
  getBinSelection:        () => call('getBinSelection'),
  getTimelineSelection:   (playheadOnly = false) => call('getTimelineSelection', playheadOnly),
  getSourceMonitorItem:   () => call('getSourceMonitorItem'),
  exportTimelineFrame:    () => call('exportTimelineFrame'),       // deprecated (QE broken on many builds)
  getTimelineFrameSource: () => call('getTimelineFrameSource'),    // source-relative phead + media path
  getTimelineInOutSource: () => call('getTimelineInOutSource'),    // source-relative seq In/Out + media path
  getSourceInOut:         () => call('getSourceInOut'),            // Source Monitor In/Out (kept as legacy)
  importToBin:            (path) => call('importToBin', path),
  revealInBin:            (projectItemId) => call('revealInBin', projectItemId),
  diagApis:               () => call('diagApis'),
};

// Promise queue: ExtendScript is single-threaded; serialize evalScript calls.
let chain = Promise.resolve();
export function hostQueued(name, ...args) {
  const next = chain.then(() => host[name](...args));
  chain = next.catch(() => {});
  return next;
}
