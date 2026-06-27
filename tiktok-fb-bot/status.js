const PHASES = {
  idle: { label: 'Idle', step: 0 },
  downloading: { label: 'Downloading', step: 1 },
  uploading: { label: 'Uploading to Facebook', step: 2 },
  cleaning: { label: 'Cleaning up', step: 3 },
};

let isRunning = false;
let current = {
  phase: 'idle',
  url: null,
  tags: [],
  pageName: null,
  message: null,
  startedAt: null,
};

let lastJob = null;

function isProcessing() {
  return isRunning;
}

function beginJob(url, tags = [], pageName = null) {
  isRunning = true;
  current = {
    phase: 'downloading',
    url,
    tags,
    pageName,
    message: 'Starting download from TikTok…',
    startedAt: new Date().toISOString(),
  };
}

function setPhase(phase, message) {
  if (!isRunning) return;
  current.phase = phase;
  if (message) current.message = message;
}

function finishJob(result) {
  lastJob = {
    result: result.type,
    url: result.url,
    message: result.message || null,
    finishedAt: new Date().toISOString(),
  };
  isRunning = false;
  current = {
    phase: 'idle',
    url: null,
    tags: [],
    pageName: null,
    message: null,
    startedAt: null,
  };
}

function abortJob() {
  isRunning = false;
  current = {
    phase: 'idle',
    url: null,
    tags: [],
    pageName: null,
    message: null,
    startedAt: null,
  };
}

function getSnapshot() {
  const phaseMeta = PHASES[current.phase] || PHASES.idle;
  return {
    active: isRunning,
    phase: current.phase,
    phaseLabel: phaseMeta.label,
    step: phaseMeta.step,
    totalSteps: 3,
    url: current.url,
    tags: current.tags,
    pageName: current.pageName,
    message: current.message,
    startedAt: current.startedAt,
    lastJob,
  };
}

module.exports = {
  isProcessing,
  beginJob,
  setPhase,
  finishJob,
  abortJob,
  getSnapshot,
};
