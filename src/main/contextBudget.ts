/** Budget reference data only. Current instructions, task IDs and approvals stay intact. */
export function boundReference(text: string, maxChars = 12_000): string {
  if (text.length <= maxChars) return text;
  const marker = `\n[Reference shortened from ${text.length} characters; inspect source files for omitted details.]\n`;
  const available = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(available / 2);
  return text.slice(0, head) + marker + text.slice(text.length - (available - head));
}

/** Keep every finding represented, the actual verdict, and a bounded evidence excerpt. */
export function budgetHostEvidence<T extends { ok: boolean; findings: string[]; evidence?: string[] }>(result: T) {
  const findings = result.findings.slice(0, 50).map(value => boundReference(value, 600));
  const evidence = result.evidence?.slice(0, 20).map(value => boundReference(value, 800));
  return {
    ok: result.ok && result.findings.length === 0,
    findings,
    ...(evidence ? { evidence } : {}),
    ...(JSON.stringify({ findings, evidence }) !== JSON.stringify({ findings: result.findings, evidence: result.evidence })
      ? { contextNotice: 'Evidence excerpts are shortened; inspect referenced source reports. Omitted details are not a pass.',
        findingCount: result.findings.length, evidenceCount: result.evidence?.length ?? 0 }
      : {}),
  };
}
