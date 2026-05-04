// In-memory job store for local dev. Not persistent across restarts.
const jobs = new Map();

function createJob(id) {
  const job = { id, status: 'pending', progress: 0, total: 0, error: null };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
}

module.exports = { createJob, getJob, updateJob };
