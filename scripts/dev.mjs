// Levanta el servidor (API) y el cliente (Vite) juntos. Ctrl+C cierra ambos.
import { spawn } from 'node:child_process';

const procs = [
  ['servidor', ['run', 'dev', '-w', 'server']],
  ['cliente', ['run', 'dev', '-w', 'client']],
].map(([name, args]) => {
  const p = spawn('npm', args, { stdio: ['inherit', 'pipe', 'pipe'], shell: true });
  const tag = (chunk) => chunk.toString().replace(/^(?=.)/gm, `[${name}] `);
  p.stdout.on('data', (d) => process.stdout.write(tag(d)));
  p.stderr.on('data', (d) => process.stderr.write(tag(d)));
  p.on('exit', (code) => {
    console.log(`[${name}] terminó (${code})`);
    for (const other of procs) if (other !== p) other.kill();
    process.exit(code ?? 0);
  });
  return p;
});

process.on('SIGINT', () => procs.forEach((p) => p.kill()));
