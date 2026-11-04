const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');
const frontendDir = path.join(rootDir, 'frontend');

const isWindows = process.platform === 'win32';

// Colors for terminal logs
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

function log(prefix, color, message) {
  const lines = message.toString().split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().length > 0) {
      console.log(`${color}${prefix}${colors.reset} ${line}`);
    }
  }
}

function findPython() {
  const candidates = [
    path.join(backendDir, '.venv', 'Scripts', 'python.exe'),
    path.join(rootDir, '.venv', 'Scripts', 'python.exe'),
    path.join(backendDir, '.venv', 'bin', 'python'),
    path.join(rootDir, '.venv', 'bin', 'python'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback to system python
  return isWindows ? 'python' : 'python3';
}

const pythonExecutable = findPython();
const npmExecutable = isWindows ? 'npm.cmd' : 'npm';

console.log(`${colors.bright}${colors.cyan}====================================================${colors.reset}`);
console.log(`${colors.bright}${colors.green}   🚀 FINSK FULL-STACK SYSTEM IS STARTING UP...${colors.reset}`);
console.log(`${colors.bright}${colors.cyan}====================================================${colors.reset}`);
console.log(`${colors.gray}Python executable:${colors.reset} ${pythonExecutable}`);
console.log(`${colors.gray}Backend Path:     ${colors.reset} ${backendDir}`);
console.log(`${colors.gray}Frontend Path:    ${colors.reset} ${frontendDir}`);
console.log(`${colors.bright}----------------------------------------------------${colors.reset}`);
console.log(`${colors.cyan}📍 Backend API:${colors.reset}   http://127.0.0.1:8000`);
console.log(`${colors.cyan}📍 API Docs:${colors.reset}      http://127.0.0.1:8000/docs`);
console.log(`${colors.magenta}📍 Frontend UI:${colors.reset}  http://localhost:3000`);
console.log(`${colors.bright}----------------------------------------------------${colors.reset}`);
console.log(`${colors.yellow}Press Ctrl+C to stop both servers at any time.${colors.reset}\n`);

const args = process.argv.slice(2);
const backendOnly = args.includes('--backend-only');
const frontendOnly = args.includes('--frontend-only');

const childProcesses = [];

function killProcessTree(pid) {
  try {
    if (isWindows) {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch (e) {
    // Process already killed or exited
  }
}

function cleanExit() {
  console.log(`\n${colors.yellow}Stopping all services...${colors.reset}`);
  for (const child of childProcesses) {
    if (child && child.pid) {
      killProcessTree(child.pid);
    }
  }
  process.exit(0);
}

process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);
process.on('exit', () => {
  for (const child of childProcesses) {
    if (child && child.pid) {
      killProcessTree(child.pid);
    }
  }
});

// Start Backend
if (!frontendOnly) {
  const backendEnv = {
    ...process.env,
    PYTHONPATH: backendDir,
  };

  const backendProc = spawn(
    pythonExecutable,
    ['-m', 'uvicorn', 'app.main:app', '--reload', '--host', '127.0.0.1', '--port', '8000'],
    {
      cwd: backendDir,
      env: backendEnv,
      stdio: ['inherit', 'pipe', 'pipe'],
    }
  );

  childProcesses.push(backendProc);

  readline.createInterface({ input: backendProc.stdout }).on('line', (line) => {
    log('[Backend]', colors.cyan, line);
  });

  readline.createInterface({ input: backendProc.stderr }).on('line', (line) => {
    log('[Backend]', colors.cyan, line);
  });

  backendProc.on('error', (err) => {
    log('[Backend Error]', colors.red, err.message);
  });

  backendProc.on('close', (code) => {
    log('[Backend]', colors.yellow, `Process exited with code ${code}`);
  });
}

// Start Frontend
if (!backendOnly) {
  const frontendProc = spawn(npmExecutable, ['run', 'dev'], {
    cwd: frontendDir,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
  });

  childProcesses.push(frontendProc);

  readline.createInterface({ input: frontendProc.stdout }).on('line', (line) => {
    log('[Frontend]', colors.magenta, line);
  });

  readline.createInterface({ input: frontendProc.stderr }).on('line', (line) => {
    log('[Frontend]', colors.magenta, line);
  });

  frontendProc.on('error', (err) => {
    log('[Frontend Error]', colors.red, err.message);
  });

  frontendProc.on('close', (code) => {
    log('[Frontend]', colors.yellow, `Process exited with code ${code}`);
  });
}

