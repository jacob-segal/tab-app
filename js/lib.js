// Single import point for Preact + hooks + htm (no build step).
// Pages: `import { html, useState, useEffect, ... } from '../lib.js';`
// Note: the standalone bundle has no Fragment export — use the one below, or
// return multiple root elements from html`` (renders as an array).
export {
  h, html, render, Component, createContext,
  useState, useReducer, useEffect, useLayoutEffect, useRef, useImperativeHandle,
  useMemo, useCallback, useContext, useErrorBoundary,
} from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

export const Fragment = props => props.children;

// Tiny classnames helper: cx('a', cond && 'b', {c: cond}) -> "a b c"
export function cx(...args) {
  const out = [];
  for (const a of args) {
    if (!a) continue;
    if (typeof a === 'string') out.push(a);
    else if (typeof a === 'object') for (const [k, v] of Object.entries(a)) if (v) out.push(k);
  }
  return out.join(' ');
}
