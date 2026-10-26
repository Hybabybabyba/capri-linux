'use strict';

const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[приватный ключ вырезан]'],
  [/\b(gsk_|ghp_|gho_|ghs_|ghu_|github_pat_|glpat-|sk-|sk_live_|rk_live_|xox[abpr]-|AKIA|AIza)[A-Za-z0-9_-]{8,}/g, '$1***'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[jwt]'],
  [/\b(password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|client[_-]?secret|authorization|cookie)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2***'],
  [/(\/\/[^/\s:@]+:)[^@\s/]+@/g, '$1***@'],
];

const redact = (text) => PATTERNS.reduce((s, [re, to]) => s.replace(re, to), String(text ?? ''));

module.exports = { redact };
