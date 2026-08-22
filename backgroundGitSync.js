const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const jobPath = process.argv[2];

function runGit(folder, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: folder, timeout: 60_000, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout || ''}${stderr || ''}`.trim() });
    });
  });
}

function saveJob(job) {
  const temporary = `${jobPath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(job, null, 2), 'utf8');
  fs.renameSync(temporary, jobPath);
}

async function attempt() {
  let job;
  try { job = JSON.parse(fs.readFileSync(jobPath, 'utf8')); }
  catch { process.exit(0); }

  if (!job.folder || !fs.existsSync(job.folder)) {
    saveJob({ ...job, lastAttempt: new Date().toISOString(), lastError: 'Project folder is unavailable.' });
    setTimeout(attempt, 30_000);
    return;
  }

  const result = await runGit(job.folder, ['push', '-u', 'origin', 'HEAD']);
  if (result.ok) {
    try { fs.unlinkSync(jobPath); } catch {}
    process.exit(0);
  }

  saveJob({ ...job, lastAttempt: new Date().toISOString(), lastError: result.output || 'GitHub push failed.' });
  setTimeout(attempt, 30_000);
}

if (!jobPath || path.extname(jobPath).toLowerCase() !== '.json') process.exit(1);
attempt();
