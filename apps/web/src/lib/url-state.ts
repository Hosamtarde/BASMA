import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

/**
 * State that lives in the address (reload, back/forward and shared links keep it) but answers
 * the user at once. React Router applies a URL change asynchronously (in a transition), so
 * controls driven straight from the URL lag behind a click, and two quick changes computed from
 * the same rendered URL overwrite each other. Here the controls read React state; every change is
 * mirrored to the URL (replace), and URL changes we did not make ourselves are adopted.
 */
export function useUrlState<T>(
  parse: (params: URLSearchParams) => T,
  serialize: (state: T) => URLSearchParams,
): [T, (update: (prev: T) => T) => void] {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<T>(() => parse(params));
  const urlKey = params.toString();
  // URLs we wrote and have not seen rendered yet, oldest first.
  const written = useRef<string[]>([]);
  // The URL that matches the current state (written by us or adopted from outside).
  const synced = useRef(urlKey);
  const parseRef = useRef(parse);
  const serializeRef = useRef(serialize);
  useEffect(() => {
    parseRef.current = parse;
    serializeRef.current = serialize;
  });

  // URL → state, only for changes made elsewhere (reload, back/forward, a link).
  useEffect(() => {
    const i = written.current.indexOf(urlKey);
    if (i >= 0) {
      written.current.splice(0, i + 1);
      return;
    }
    if (urlKey === synced.current) return;
    synced.current = urlKey;
    // Adopting an outside navigation (an external change).
    setState(parseRef.current(new URLSearchParams(urlKey)));
  }, [urlKey]);

  // State → URL.
  useEffect(() => {
    const next = serializeRef.current(state);
    const key = next.toString();
    if (key === synced.current) return;
    synced.current = key;
    written.current.push(key);
    setParams(next, { replace: true });
  }, [state, setParams]);

  const update = useCallback((fn: (prev: T) => T) => setState(fn), []);
  return [state, update];
}
