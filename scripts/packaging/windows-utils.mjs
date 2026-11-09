import { open } from 'node:fs/promises';

// Inspect binaries without executing them (also works on the Mac build host).
export async function assertWindowsX64(path) {
  const file = await open(path, 'r');
  try {
    const dos = Buffer.alloc(64);
    if ((await file.read(dos, 0, dos.length, 0)).bytesRead !== 64 || dos.toString('ascii', 0, 2) !== 'MZ') throw Error(`不是 Windows 程序：${path}`);
    const pe = Buffer.alloc(6);
    await file.read(pe, 0, pe.length, dos.readUInt32LE(60));
    if (pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664) throw Error(`不是 Windows x64 程序：${path}`);
  } finally { await file.close(); }
}
