// Readiness belongs to the first live result, not the empty RTK cache seed.
export const pendingStream = (value) => ({ value, ready: false, error: null });
export function selectStreamResult(result) {
  const stream = result.currentData;
  const error = result.error || stream?.error;
  const waiting = !result.isUninitialized && !error && !stream?.ready;
  return { ...result, data: stream?.value, currentData: stream?.value,
    isLoading: waiting, isFetching: waiting, isSuccess: Boolean(stream?.ready && !error && !result.isUninitialized), isError: Boolean(error), error };
}
export function streamQueryHook(useQuery) {
  return function useReadyStreamQuery(arg, options = {}) {
    return useQuery(arg, { ...options, selectFromResult: result => {
      const selected = selectStreamResult(result);
      return options.selectFromResult ? options.selectFromResult(selected) : selected;
    } });
  };
}
export function failStream(draft, error) {
  draft.ready = true;
  draft.error = { code: error?.code || "stream-error", message: error?.message || "Could not load live data." };
}
