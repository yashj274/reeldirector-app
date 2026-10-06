type BetaEvent = 'scan' | 'ai_request' | 'storyboard' | 'recording' | 'upload' | 'render' | 'export';
type BetaState = 'started' | 'completed' | 'failed';

export function logBeta(event: BetaEvent, state: BetaState) {
  if (__DEV__) console.info(`[beta] ${event}:${state}`);
}
